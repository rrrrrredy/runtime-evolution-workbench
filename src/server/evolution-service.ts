import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { createTwoFilesPatch } from "diff";

import { sha256 } from "../shared/ids.js";
import type { CapabilityProposal, CapabilityTargetKind, PublishEvent } from "../shared/types.js";
import { ContentStore } from "./content-store.js";
import { redactUnknown } from "./redaction.js";
import { WorkbenchStore } from "./store.js";

export interface CreateProposalInput {
  issueId: string;
  workspaceRoot: string;
  targetPath: string;
  targetKind: CapabilityTargetKind;
  candidateContent: string;
  rationale: string;
  originalRunId: string;
  protectionRunId: string;
}

export interface ProposalDetail {
  proposal: CapabilityProposal;
  publishEvents: PublishEvent[];
  originalContent: string;
  candidateContent: string;
}

export interface AtomicReplaceInput {
  targetPath: string;
  expectedDigest: string;
  desiredContent: string;
  desiredDigest: string;
}

export type AtomicFileReplacer = (input: AtomicReplaceInput) => string;

export class ConcurrentTargetChangeError extends Error {
  constructor(readonly currentDigest: string) {
    super("The target changed immediately before atomic replacement");
    this.name = "ConcurrentTargetChangeError";
  }
}

export function replaceFileAtomically(input: AtomicReplaceInput): string {
  const temporaryPath = join(
    dirname(input.targetPath),
    `.${basename(input.targetPath)}.runtime-evolution-${randomUUID()}.tmp`
  );
  let descriptor: number | null = null;
  try {
    const mode = statSync(input.targetPath).mode & 0o777;
    descriptor = openSync(temporaryPath, "wx", mode);
    writeFileSync(descriptor, input.desiredContent, { encoding: "utf8" });
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;

    const stagedDigest = sha256(readFileSync(temporaryPath));
    if (stagedDigest !== input.desiredDigest) {
      throw new Error("The staged capability file did not match the approved digest");
    }
    const commitDigest = sha256(readFileSync(input.targetPath));
    if (commitDigest !== input.expectedDigest) throw new ConcurrentTargetChangeError(commitDigest);

    renameSync(temporaryPath, input.targetPath);
    const resultingDigest = sha256(readFileSync(input.targetPath));
    if (resultingDigest !== input.desiredDigest) {
      throw new Error("The atomically replaced capability file did not match the approved digest");
    }
    return resultingDigest;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function safeTarget(workspaceRoot: string, targetPath: string, kind: CapabilityTargetKind): { root: string; fullPath: string; relativePath: string } {
  if (isAbsolute(targetPath)) throw new Error("targetPath must be relative to workspaceRoot");
  const normalizedRelative = targetPath.replaceAll("\\", "/");
  if (normalizedRelative.split("/").some((part) => part === ".." || part.length === 0)) {
    throw new Error("targetPath cannot contain parent traversal or empty segments");
  }
  const expectedName = kind === "agents" ? "AGENTS.md" : "SKILL.md";
  if (basename(normalizedRelative).toLowerCase() !== expectedName.toLowerCase()) {
    throw new Error(`${kind} proposals must target ${expectedName}`);
  }
  const root = realpathSync(workspaceRoot);
  const requested = resolve(root, normalizedRelative);
  const fullPath = realpathSync(requested);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (fullPath !== root && !fullPath.startsWith(prefix)) throw new Error("Target resolves outside workspaceRoot");
  const relativePath = relative(root, fullPath).replaceAll("\\", "/");
  return { root, fullPath, relativePath };
}

export class EvolutionService {
  constructor(
    readonly store: WorkbenchStore,
    readonly contentStore: ContentStore,
    readonly replaceFile: AtomicFileReplacer = replaceFileAtomically
  ) {}

  createProposal(input: CreateProposalInput): CapabilityProposal {
    if (input.candidateContent.length === 0) throw new Error("candidateContent cannot be empty");
    if (input.rationale.trim().length === 0) throw new Error("rationale cannot be empty");
    if (input.originalRunId === input.protectionRunId) throw new Error("A distinct protection Run is required");
    if (this.store.getIssue(input.issueId) === null) throw new Error("Issue not found");
    if (this.store.getRun(input.originalRunId) === null) throw new Error("Original failure Run not found");
    if (this.store.getRun(input.protectionRunId) === null) throw new Error("Protection Run not found");

    const target = safeTarget(input.workspaceRoot, input.targetPath, input.targetKind);
    const originalContent = readFileSync(target.fullPath, "utf8");
    if (originalContent === input.candidateContent) throw new Error("Candidate content is identical to the current file");
    const originalSafety = redactUnknown(originalContent);
    const candidateSafety = redactUnknown(input.candidateContent);
    if (originalSafety.redactedFieldCount > 0 || candidateSafety.redactedFieldCount > 0) {
      throw new Error("The target or candidate contains secret-like material and cannot be retained in a proposal");
    }
    if (originalSafety.truncatedFieldCount > 0 || candidateSafety.truncatedFieldCount > 0) {
      throw new Error("AGENTS.md and SKILL.md proposals are limited to 64 KiB per file in the MVP");
    }
    const original = this.contentStore.put(originalContent);
    const candidate = this.contentStore.put(input.candidateContent);
    const diffText = createTwoFilesPatch(
      `a/${target.relativePath}`,
      `b/${target.relativePath}`,
      originalContent,
      input.candidateContent,
      "current",
      "candidate",
      { context: 5 }
    );
    return this.store.createProposalRecord({
      issueId: input.issueId,
      workspaceRoot: target.root,
      targetPath: target.relativePath,
      targetKind: input.targetKind,
      originalDigest: original.digest,
      originalContentRef: original.ref,
      candidateDigest: candidate.digest,
      candidateContentRef: candidate.ref,
      diffText,
      rationale: input.rationale.trim(),
      status: "ready",
      originalRunId: input.originalRunId,
      protectionRunId: input.protectionRunId
    });
  }

  getProposalDetail(id: string): ProposalDetail | null {
    const proposal = this.store.getProposal(id);
    if (proposal === null) return null;
    return {
      proposal,
      publishEvents: this.store.listPublishEvents(id),
      originalContent: this.contentStore.read(proposal.originalContentRef).toString("utf8"),
      candidateContent: this.contentStore.read(proposal.candidateContentRef).toString("utf8")
    };
  }

  approve(id: string): CapabilityProposal {
    const proposal = this.#requireProposal(id);
    if (proposal.status !== "ready" && proposal.status !== "rejected") {
      throw new Error(`Proposal cannot be approved from status ${proposal.status}`);
    }
    const supportedComparison = this.store.listComparisons(id).find(
      (comparison) => comparison.status === "completed" && comparison.conclusion === "candidate_supported"
    );
    if (supportedComparison === undefined) {
      throw new Error("Approval requires a completed comparison that supports the candidate; single-run evidence will remain labeled as such");
    }
    this.store.updateProposalStatus(id, "approved");
    return this.#requireProposal(id);
  }

  reject(id: string): CapabilityProposal {
    const proposal = this.#requireProposal(id);
    if (proposal.status === "published" || proposal.status === "rolled_back") {
      throw new Error(`Proposal cannot be rejected from status ${proposal.status}`);
    }
    this.store.updateProposalStatus(id, "rejected");
    return this.#requireProposal(id);
  }

  publish(id: string): PublishEvent {
    const proposal = this.#requireProposal(id);
    if (proposal.status !== "approved") throw new Error("Proposal requires explicit approval before publishing");
    const target = safeTarget(proposal.workspaceRoot, proposal.targetPath, proposal.targetKind);
    const currentContent = readFileSync(target.fullPath, "utf8");
    const currentDigest = sha256(currentContent);
    if (currentDigest === proposal.candidateDigest) {
      const publishedAt = new Date().toISOString();
      this.store.updateProposalStatus(proposal.id, "published", publishedAt);
      return this.store.addPublishEvent({
        proposalId: proposal.id,
        action: "publish",
        status: "applied",
        targetPath: target.fullPath,
        expectedDigest: proposal.candidateDigest,
        currentDigest,
        resultingDigest: currentDigest,
        currentContentRef: null,
        message: "The approved candidate was already present; publication metadata was reconciled after an interrupted atomic commit."
      });
    }
    if (currentDigest !== proposal.originalDigest) {
      const currentRef = this.contentStore.put(currentContent).ref;
      return this.store.addPublishEvent({
        proposalId: proposal.id,
        action: "publish",
        status: "conflict",
        targetPath: target.fullPath,
        expectedDigest: proposal.originalDigest,
        currentDigest,
        resultingDigest: null,
        currentContentRef: currentRef,
        message: "The target changed after the proposal was created. No file was overwritten; review the three versions."
      });
    }
    const candidateContent = this.contentStore.read(proposal.candidateContentRef).toString("utf8");
    if (sha256(candidateContent) !== proposal.candidateDigest) {
      throw new Error("The retained candidate backup no longer matches the approved digest");
    }
    let resultingDigest: string;
    try {
      resultingDigest = this.replaceFile({
        targetPath: target.fullPath,
        expectedDigest: proposal.originalDigest,
        desiredContent: candidateContent,
        desiredDigest: proposal.candidateDigest
      });
    } catch (error) {
      const afterContent = readFileSync(target.fullPath, "utf8");
      const afterDigest = sha256(afterContent);
      if (error instanceof ConcurrentTargetChangeError) {
        return this.store.addPublishEvent({
          proposalId: proposal.id,
          action: "publish",
          status: "conflict",
          targetPath: target.fullPath,
          expectedDigest: proposal.originalDigest,
          currentDigest: afterDigest,
          resultingDigest: null,
          currentContentRef: this.contentStore.put(afterContent).ref,
          message: "The target changed immediately before atomic replacement. No user edit was overwritten."
        });
      }
      const event = this.store.addPublishEvent({
        proposalId: proposal.id,
        action: "publish",
        status: "failed",
        targetPath: target.fullPath,
        expectedDigest: proposal.originalDigest,
        currentDigest,
        resultingDigest: afterDigest,
        currentContentRef: this.contentStore.put(afterContent).ref,
        message: `Atomic publication failed; retained recovery refs remain available. ${error instanceof Error ? error.message : String(error)}`
      });
      throw new Error(event.message);
    }
    const publishedAt = new Date().toISOString();
    this.store.updateProposalStatus(proposal.id, "published", publishedAt);
    return this.store.addPublishEvent({
      proposalId: proposal.id,
      action: "publish",
      status: "applied",
      targetPath: target.fullPath,
      expectedDigest: proposal.originalDigest,
      currentDigest,
      resultingDigest,
      currentContentRef: null,
      message: "Approved candidate published after the original file hash matched."
    });
  }

  rollback(id: string): PublishEvent {
    const proposal = this.#requireProposal(id);
    if (proposal.status !== "published" && proposal.status !== "rollback_conflict") {
      throw new Error(`Proposal cannot be rolled back from status ${proposal.status}`);
    }
    const target = safeTarget(proposal.workspaceRoot, proposal.targetPath, proposal.targetKind);
    const currentContent = readFileSync(target.fullPath, "utf8");
    const currentDigest = sha256(currentContent);
    if (currentDigest === proposal.originalDigest) {
      this.store.updateProposalStatus(proposal.id, "rolled_back");
      return this.store.addPublishEvent({
        proposalId: proposal.id,
        action: "rollback",
        status: "applied",
        targetPath: target.fullPath,
        expectedDigest: proposal.originalDigest,
        currentDigest,
        resultingDigest: currentDigest,
        currentContentRef: null,
        message: "The original was already present; rollback metadata was reconciled after an interrupted atomic commit."
      });
    }
    if (currentDigest !== proposal.candidateDigest) {
      const currentRef = this.contentStore.put(currentContent).ref;
      this.store.updateProposalStatus(proposal.id, "rollback_conflict");
      return this.store.addPublishEvent({
        proposalId: proposal.id,
        action: "rollback",
        status: "conflict",
        targetPath: target.fullPath,
        expectedDigest: proposal.candidateDigest,
        currentDigest,
        resultingDigest: null,
        currentContentRef: currentRef,
        message: "The published file has later user edits. Nothing was overwritten; use the original, candidate, and current refs for three-way review."
      });
    }
    const originalContent = this.contentStore.read(proposal.originalContentRef).toString("utf8");
    if (sha256(originalContent) !== proposal.originalDigest) {
      throw new Error("The retained original backup no longer matches the proposal digest");
    }
    let resultingDigest: string;
    try {
      resultingDigest = this.replaceFile({
        targetPath: target.fullPath,
        expectedDigest: proposal.candidateDigest,
        desiredContent: originalContent,
        desiredDigest: proposal.originalDigest
      });
    } catch (error) {
      const afterContent = readFileSync(target.fullPath, "utf8");
      const afterDigest = sha256(afterContent);
      if (error instanceof ConcurrentTargetChangeError) {
        this.store.updateProposalStatus(proposal.id, "rollback_conflict");
        return this.store.addPublishEvent({
          proposalId: proposal.id,
          action: "rollback",
          status: "conflict",
          targetPath: target.fullPath,
          expectedDigest: proposal.candidateDigest,
          currentDigest: afterDigest,
          resultingDigest: null,
          currentContentRef: this.contentStore.put(afterContent).ref,
          message: "The target changed immediately before atomic rollback. No user edit was overwritten."
        });
      }
      const event = this.store.addPublishEvent({
        proposalId: proposal.id,
        action: "rollback",
        status: "failed",
        targetPath: target.fullPath,
        expectedDigest: proposal.candidateDigest,
        currentDigest,
        resultingDigest: afterDigest,
        currentContentRef: this.contentStore.put(afterContent).ref,
        message: `Atomic rollback failed; retained recovery refs remain available. ${error instanceof Error ? error.message : String(error)}`
      });
      throw new Error(event.message);
    }
    this.store.updateProposalStatus(proposal.id, "rolled_back");
    return this.store.addPublishEvent({
      proposalId: proposal.id,
      action: "rollback",
      status: "applied",
      targetPath: target.fullPath,
      expectedDigest: proposal.candidateDigest,
      currentDigest,
      resultingDigest,
      currentContentRef: null,
      message: "Original content restored because the current file still matched the published candidate."
    });
  }

  #requireProposal(id: string): CapabilityProposal {
    const proposal = this.store.getProposal(id);
    if (proposal === null) throw new Error("Proposal not found");
    return proposal;
  }
}

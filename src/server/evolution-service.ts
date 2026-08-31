import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { createTwoFilesPatch } from "diff";

import { sha256 } from "../shared/ids.js";
import type { CapabilityProposal, CapabilityTargetKind, PublishEvent } from "../shared/types.js";
import { ContentStore } from "./content-store.js";
import {
  adoptFileWithoutOverwrite,
  ConcurrentTargetChangeError,
  FileAdoptionError,
  type FileAdoptionInput,
  type FileAdoptionResult
} from "./file-adoption.js";
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

export type AtomicReplaceInput = FileAdoptionInput;
export type AtomicFileReplacer = (input: AtomicReplaceInput) => FileAdoptionResult;
export const replaceFileWithoutOverwrite = adoptFileWithoutOverwrite;
export { ConcurrentTargetChangeError, FileAdoptionError };

function safeTarget(workspaceRoot: string, targetPath: string, kind: CapabilityTargetKind, allowMissing = false): { root: string; fullPath: string; relativePath: string } {
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
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (requested !== root && !requested.startsWith(prefix)) throw new Error("Target resolves outside workspaceRoot");
  let fullPath: string;
  if (existsSync(requested)) {
    fullPath = realpathSync(requested);
  } else {
    if (!allowMissing) throw new Error("Target capability file does not exist");
    const parent = realpathSync(dirname(requested));
    if (parent !== root && !parent.startsWith(prefix)) throw new Error("Target parent resolves outside workspaceRoot");
    fullPath = requested;
  }
  if (fullPath !== root && !fullPath.startsWith(prefix)) throw new Error("Target resolves outside workspaceRoot");
  const relativePath = relative(root, fullPath).replaceAll("\\", "/");
  return { root, fullPath, relativePath };
}

function failureEvidence(error: unknown, targetPath: string, contentStore: ContentStore): {
  currentDigest: string;
  currentContentRef: string | null;
  recoveryPath: string | null;
} {
  const recoveryPath = error instanceof FileAdoptionError ? error.recoveryPath : null;
  const evidencePath = error instanceof FileAdoptionError
    ? error.evidencePath
    : existsSync(targetPath) ? targetPath : null;
  if (evidencePath !== null && existsSync(evidencePath)) {
    const content = readFileSync(evidencePath);
    return { currentDigest: sha256(content), currentContentRef: contentStore.put(content).ref, recoveryPath };
  }
  return {
    currentDigest: error instanceof FileAdoptionError ? error.currentDigest : "missing",
    currentContentRef: null,
    recoveryPath
  };
}

function recoveryMessage(path: string | null): string {
  return path === null
    ? ""
    : ` Recovery file retained at ${path}; close any editor using the old file, then compare it with the current target before deleting it.`;
}

export class EvolutionService {
  constructor(
    readonly store: WorkbenchStore,
    readonly contentStore: ContentStore,
    readonly replaceFile: AtomicFileReplacer = replaceFileWithoutOverwrite
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
    const target = safeTarget(proposal.workspaceRoot, proposal.targetPath, proposal.targetKind, true);
    const candidateContent = this.contentStore.read(proposal.candidateContentRef).toString("utf8");
    if (sha256(candidateContent) !== proposal.candidateDigest) {
      throw new Error("The retained candidate backup no longer matches the approved digest");
    }
    let adoption: FileAdoptionResult;
    try {
      adoption = this.replaceFile({
        operationId: `${proposal.id}:publish`,
        action: "publish",
        workspaceRoot: target.root,
        targetPath: target.fullPath,
        expectedDigest: proposal.originalDigest,
        desiredContent: candidateContent,
        desiredDigest: proposal.candidateDigest
      });
    } catch (error) {
      const evidence = failureEvidence(error, target.fullPath, this.contentStore);
      if (error instanceof ConcurrentTargetChangeError) {
        return this.store.addPublishEvent({
          proposalId: proposal.id,
          action: "publish",
          status: "conflict",
          targetPath: target.fullPath,
          expectedDigest: proposal.originalDigest,
          currentDigest: evidence.currentDigest,
          resultingDigest: null,
          currentContentRef: evidence.currentContentRef,
          message: `${error.message}. No file was overwritten.${recoveryMessage(evidence.recoveryPath)}`
        });
      }
      const event = this.store.addPublishEvent({
        proposalId: proposal.id,
        action: "publish",
        status: "failed",
        targetPath: target.fullPath,
        expectedDigest: proposal.originalDigest,
        currentDigest: evidence.currentDigest,
        resultingDigest: existsSync(target.fullPath) ? sha256(readFileSync(target.fullPath)) : null,
        currentContentRef: evidence.currentContentRef,
        message: `Non-overwriting publication failed. ${error instanceof Error ? error.message : String(error)}${recoveryMessage(evidence.recoveryPath)}`
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
      currentDigest: adoption.previousDigest,
      resultingDigest: adoption.resultingDigest,
      currentContentRef: null,
      message: adoption.recoveryPath === null
        ? "The approved candidate was already present; publication metadata was reconciled without changing the file."
        : `Approved candidate adopted without overwriting an existing target.${recoveryMessage(adoption.recoveryPath)}`
    });
  }

  rollback(id: string): PublishEvent {
    const proposal = this.#requireProposal(id);
    if (proposal.status !== "published" && proposal.status !== "rollback_conflict") {
      throw new Error(`Proposal cannot be rolled back from status ${proposal.status}`);
    }
    const target = safeTarget(proposal.workspaceRoot, proposal.targetPath, proposal.targetKind, true);
    const originalContent = this.contentStore.read(proposal.originalContentRef).toString("utf8");
    if (sha256(originalContent) !== proposal.originalDigest) {
      throw new Error("The retained original backup no longer matches the proposal digest");
    }
    let adoption: FileAdoptionResult;
    try {
      adoption = this.replaceFile({
        operationId: `${proposal.id}:rollback`,
        action: "rollback",
        workspaceRoot: target.root,
        targetPath: target.fullPath,
        expectedDigest: proposal.candidateDigest,
        desiredContent: originalContent,
        desiredDigest: proposal.originalDigest
      });
    } catch (error) {
      const evidence = failureEvidence(error, target.fullPath, this.contentStore);
      if (error instanceof ConcurrentTargetChangeError) {
        this.store.updateProposalStatus(proposal.id, "rollback_conflict");
        return this.store.addPublishEvent({
          proposalId: proposal.id,
          action: "rollback",
          status: "conflict",
          targetPath: target.fullPath,
          expectedDigest: proposal.candidateDigest,
          currentDigest: evidence.currentDigest,
          resultingDigest: null,
          currentContentRef: evidence.currentContentRef,
          message: `${error.message}. No file was overwritten.${recoveryMessage(evidence.recoveryPath)}`
        });
      }
      const event = this.store.addPublishEvent({
        proposalId: proposal.id,
        action: "rollback",
        status: "failed",
        targetPath: target.fullPath,
        expectedDigest: proposal.candidateDigest,
        currentDigest: evidence.currentDigest,
        resultingDigest: existsSync(target.fullPath) ? sha256(readFileSync(target.fullPath)) : null,
        currentContentRef: evidence.currentContentRef,
        message: `Non-overwriting rollback failed. ${error instanceof Error ? error.message : String(error)}${recoveryMessage(evidence.recoveryPath)}`
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
      currentDigest: adoption.previousDigest,
      resultingDigest: adoption.resultingDigest,
      currentContentRef: null,
      message: adoption.recoveryPath === null
        ? "The original was already present; rollback metadata was reconciled without changing the file."
        : `Original content adopted without overwriting an existing target.${recoveryMessage(adoption.recoveryPath)}`
    });
  }

  #requireProposal(id: string): CapabilityProposal {
    const proposal = this.store.getProposal(id);
    if (proposal === null) throw new Error("Proposal not found");
    return proposal;
  }
}

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

import type {
  ComparisonCase,
  ComparisonRecord,
  ComparisonRunRecord,
  ComparisonVariant
} from "../shared/types.js";
import { CodexAppServerAdapter } from "./app-server/adapter.js";
import type { WorkbenchConfig } from "./config.js";
import { ContentStore } from "./content-store.js";
import { redactUnknown } from "./redaction.js";
import { WorkbenchStore } from "./store.js";

interface ProcessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

function canonicalPath(value: string): string {
  return resolve(realpathSync.native(value)).toLowerCase();
}

export interface ComparisonCaseInput {
  kind: "failure" | "protection";
  name: string;
  prompt: string;
  verifierCommand: string;
  verifierArgs: string[];
  verifierTimeoutMs?: number;
}

export interface ComparisonDetail {
  comparison: ComparisonRecord;
  cases: ComparisonCase[];
  runs: ComparisonRunRecord[];
}

function runProcess(command: string, args: string[], cwd: string, timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolvePromise, reject) => {
    const startedAt = Date.now();
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const append = (current: string, chunk: Buffer) => {
      const next = current + chunk.toString("utf8");
      return next.length > 1024 * 1024 ? next.slice(-(1024 * 1024)) : next;
    };
    child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    let settled = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      resolvePromise({ exitCode: code, stdout, stderr, timedOut, durationMs: Date.now() - startedAt });
    });
  });
}

export class ComparisonService {
  constructor(
    readonly config: WorkbenchConfig,
    readonly store: WorkbenchStore,
    readonly contentStore: ContentStore,
    readonly adapter: CodexAppServerAdapter
  ) {}

  async create(proposalId: string, cases: ComparisonCaseInput[]): Promise<ComparisonRecord> {
    const proposal = this.store.getProposal(proposalId);
    if (proposal === null) throw new Error("Proposal not found");
    if (proposal.status !== "ready") throw new Error(`Comparison requires a ready proposal, got ${proposal.status}`);
    if (cases.length !== 2 || new Set(cases.map((entry) => entry.kind)).size !== 2) {
      throw new Error("Exactly one failure case and one protection case are required");
    }
    for (const comparisonCase of cases) {
      const safety = redactUnknown({ command: comparisonCase.verifierCommand, args: comparisonCase.verifierArgs });
      if (safety.redactedFieldCount > 0 || safety.truncatedFieldCount > 0) {
        throw new Error("Verifier commands cannot contain secret-like or oversized values");
      }
    }
    const repository = await runProcess("git", ["-C", proposal.workspaceRoot, "rev-parse", "--show-toplevel"], proposal.workspaceRoot, 15_000);
    if (repository.exitCode !== 0) throw new Error(`workspaceRoot is not a Git repository: ${repository.stderr.trim()}`);
    const repositoryRoot = repository.stdout.trim();
    if (canonicalPath(repositoryRoot) !== canonicalPath(proposal.workspaceRoot)) {
      throw new Error("MVP comparisons require workspaceRoot to be the Git repository root");
    }
    const commit = await runProcess("git", ["-C", proposal.workspaceRoot, "rev-parse", "HEAD"], proposal.workspaceRoot, 15_000);
    if (commit.exitCode !== 0) throw new Error(`Could not resolve comparison base commit: ${commit.stderr.trim()}`);
    return this.store.createComparison({
      proposalId,
      baseCommit: commit.stdout.trim(),
      cases: cases.map((entry) => ({
        kind: entry.kind,
        name: entry.name,
        prompt: entry.prompt,
        verifierCommand: entry.verifierCommand,
        verifierArgs: entry.verifierArgs,
        verifierTimeoutMs: Math.max(1_000, Math.min(entry.verifierTimeoutMs ?? 120_000, 15 * 60_000))
      }))
    });
  }

  detail(id: string): ComparisonDetail | null {
    const comparison = this.store.getComparison(id);
    if (comparison === null) return null;
    return { comparison, cases: this.store.listComparisonCases(id), runs: this.store.listComparisonRuns(id) };
  }

  async cleanupInterrupted(comparisonIds: string[]): Promise<{ attempted: number; failures: string[] }> {
    const failures: string[] = [];
    let attempted = 0;
    for (const comparisonId of comparisonIds) {
      const comparison = this.store.getComparison(comparisonId);
      if (comparison === null) continue;
      const proposal = this.store.getProposal(comparison.proposalId);
      if (proposal === null) {
        failures.push(`${comparisonId}: proposal missing`);
        continue;
      }
      for (const comparisonCase of this.store.listComparisonCases(comparisonId)) {
        for (const variant of ["baseline", "candidate"] as const) {
          const worktreePath = this.#worktreePath(comparisonId, comparisonCase.kind, variant);
          attempted += 1;
          const remove = await runProcess(
            "git",
            ["-C", proposal.workspaceRoot, "worktree", "remove", "--force", worktreePath],
            proposal.workspaceRoot,
            60_000
          );
          if (remove.exitCode !== 0 && !/not a working tree|is not a working tree|does not exist/i.test(`${remove.stdout}\n${remove.stderr}`)) {
            failures.push(`${comparisonId}/${comparisonCase.kind}/${variant}: ${remove.stderr.trim() || "cleanup failed"}`);
          }
        }
      }
      const prune = await runProcess("git", ["-C", proposal.workspaceRoot, "worktree", "prune"], proposal.workspaceRoot, 30_000);
      if (prune.exitCode !== 0) failures.push(`${comparisonId}: git worktree prune failed: ${prune.stderr.trim()}`);
    }
    return { attempted, failures };
  }

  async run(id: string): Promise<ComparisonDetail> {
    const comparison = this.store.getComparison(id);
    if (comparison === null) throw new Error("Comparison not found");
    if (comparison.status !== "queued") throw new Error(`Comparison cannot start from status ${comparison.status}`);
    const proposal = this.store.getProposal(comparison.proposalId);
    if (proposal === null) throw new Error("Proposal not found");
    const cases = this.store.listComparisonCases(id);
    if (cases.length !== 2) throw new Error("Comparison does not contain exactly two cases");
    this.store.startComparison(id);
    this.store.updateProposalStatus(proposal.id, "comparing");

    let infrastructureFailure = false;
    for (const comparisonCase of cases) {
      for (const variant of ["baseline", "candidate"] as const) {
        try {
          const cleanupSucceeded = await this.#runCell(comparison, comparisonCase, variant);
          if (!cleanupSucceeded) infrastructureFailure = true;
        } catch (error) {
          infrastructureFailure = true;
          this.store.addComparisonRun({
            comparisonId: comparison.id,
            caseId: comparisonCase.id,
            variant,
            runId: null,
            verifierStatus: "not_run",
            verifierExitCode: null,
            verifierOutputRef: null,
            patchRef: null,
            durationMs: null,
            infrastructureError: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    const runs = this.store.listComparisonRuns(id);
    const caseMap = new Map(cases.map((entry) => [entry.id, entry]));
    const failureBaseline = runs.find((run) => run.variant === "baseline" && caseMap.get(run.caseId)?.kind === "failure");
    const failureCandidate = runs.find((run) => run.variant === "candidate" && caseMap.get(run.caseId)?.kind === "failure");
    const protectionBaseline = runs.find((run) => run.variant === "baseline" && caseMap.get(run.caseId)?.kind === "protection");
    const protectionCandidate = runs.find((run) => run.variant === "candidate" && caseMap.get(run.caseId)?.kind === "protection");
    const objectiveAvailable = [failureBaseline, failureCandidate, protectionBaseline, protectionCandidate].every(
      (entry) => entry !== undefined && (entry.verifierStatus === "pass" || entry.verifierStatus === "fail")
    );
    const supported = objectiveAvailable
      && failureBaseline?.verifierStatus === "fail"
      && failureCandidate?.verifierStatus === "pass"
      && protectionBaseline?.verifierStatus === "pass"
      && protectionCandidate?.verifierStatus === "pass";
    const conclusion = !objectiveAvailable
      ? "inconclusive"
      : supported
        ? "candidate_supported"
        : "candidate_not_supported";
    const summary = conclusion === "candidate_supported"
      ? "In one run per cell, the candidate fixed the failure case while both versions passed the protection case. This remains single-run evidence."
      : conclusion === "candidate_not_supported"
        ? "The four verifier results did not show a clean failure-case improvement with protection preserved."
        : "At least one required cell lacked an objective verifier result; no improvement claim is allowed.";
    this.store.finishComparison(id, infrastructureFailure ? "infrastructure_error" : "completed", summary, conclusion);
    this.store.appendSkillImpact({
      proposalId: proposal.id,
      comparisonId: comparison.id,
      action: "comparison",
      decision: conclusion === "candidate_supported"
        ? "supported"
        : conclusion === "candidate_not_supported"
          ? "not_supported"
          : "inconclusive",
      targetKind: proposal.targetKind,
      targetPath: proposal.targetPath,
      previousDigest: proposal.originalDigest,
      candidateDigest: proposal.candidateDigest,
      metrics: {
        failure_baseline_pass: failureBaseline?.verifierStatus === "pass",
        failure_candidate_pass: failureCandidate?.verifierStatus === "pass",
        protection_baseline_pass: protectionBaseline?.verifierStatus === "pass",
        protection_candidate_pass: protectionCandidate?.verifierStatus === "pass",
        managed_run_count: runs.filter((run) => run.runId !== null).length,
        infrastructure_failure: infrastructureFailure
      },
      context: { evidence_scope: "one-run-per-cell", base_commit: comparison.baseCommit },
      evidenceRefs: runs.flatMap((run) => [run.runId, run.verifierOutputRef, run.patchRef].filter((value): value is string => value !== null)),
      patternIds: [],
      securityAttestationDigest: null,
      note: summary
    });
    this.store.updateProposalStatus(proposal.id, "ready");
    const detail = this.detail(id);
    if (detail === null) throw new Error("Comparison disappeared");
    return detail;
  }

  async #runCell(comparison: ComparisonRecord, comparisonCase: ComparisonCase, variant: ComparisonVariant): Promise<boolean> {
    const proposal = this.store.getProposal(comparison.proposalId);
    if (proposal === null) throw new Error("Proposal not found");
    const experimentRoot = resolve(this.config.dataDir, "experiments", comparison.id);
    const worktreePath = this.#worktreePath(comparison.id, comparisonCase.kind, variant);
    mkdirSync(experimentRoot, { recursive: true });
    const add = await runProcess("git", ["-C", proposal.workspaceRoot, "worktree", "add", "--detach", worktreePath, comparison.baseCommit], proposal.workspaceRoot, 60_000);
    if (add.exitCode !== 0) throw new Error(`git worktree add failed: ${add.stderr.trim()}`);

    const startedAt = Date.now();
    let runId: string | null = null;
    let cleanupSucceeded = true;
    try {
      const capabilityContent = this.contentStore.read(variant === "baseline" ? proposal.originalContentRef : proposal.candidateContentRef).toString("utf8");
      writeFileSync(join(worktreePath, proposal.targetPath), capabilityContent, "utf8");
      const managed = await this.adapter.runManaged({
        cwd: worktreePath,
        prompt: comparisonCase.prompt,
        sandbox: "workspace-write",
        effort: "low",
        timeoutMs: Math.max(120_000, comparisonCase.verifierTimeoutMs)
      });
      runId = managed.bundle.run.id;

      let verifier: ProcessResult;
      try {
        verifier = await runProcess(
          comparisonCase.verifierCommand,
          comparisonCase.verifierArgs,
          worktreePath,
          comparisonCase.verifierTimeoutMs
        );
      } catch (error) {
        verifier = {
          exitCode: null,
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error),
          timedOut: false,
          durationMs: 0
        };
      }
      const redactedOutput = redactUnknown({ stdout: verifier.stdout, stderr: verifier.stderr });
      const verifierOutputRef = this.contentStore.putJson(redactedOutput.value).ref;
      const diff = await runProcess("git", ["-C", worktreePath, "diff", "--binary"], worktreePath, 30_000);
      const redactedPatch = redactUnknown(`${diff.stdout}${diff.stderr}`);
      const patchRef = this.contentStore.put(redactedPatch.value).ref;
      const verifierStatus = verifier.timedOut ? "timeout" : verifier.exitCode === 0 ? "pass" : verifier.exitCode === null ? "error" : "fail";
      this.store.updateOutcome(
        runId,
        verifierStatus === "pass" ? "success" : verifierStatus === "fail" ? "failure" : "unknown",
        `Objective verifier ${verifierStatus}${verifier.exitCode === null ? "" : ` (exit ${verifier.exitCode})`}.`
      );
      this.store.addComparisonRun({
        comparisonId: comparison.id,
        caseId: comparisonCase.id,
        variant,
        runId,
        verifierStatus,
        verifierExitCode: verifier.exitCode,
        verifierOutputRef,
        patchRef,
        durationMs: Date.now() - startedAt,
        infrastructureError: ""
      });
    } finally {
      const remove = await runProcess("git", ["-C", proposal.workspaceRoot, "worktree", "remove", "--force", worktreePath], proposal.workspaceRoot, 60_000);
      if (remove.exitCode !== 0) {
        cleanupSucceeded = false;
        const message = `git worktree cleanup failed: ${remove.stderr.trim()}`;
        this.store.markComparisonRunInfrastructure(comparison.id, comparisonCase.id, variant, message);
        if (runId !== null) {
          this.store.addGap({
            runId,
            kind: "source_unavailable",
            summary: message,
            source: "git-worktree-cleanup",
            startAt: null,
            endAt: null
          });
        }
      }
      await runProcess("git", ["-C", proposal.workspaceRoot, "worktree", "prune"], proposal.workspaceRoot, 30_000);
    }
    return cleanupSucceeded;
  }

  #worktreePath(comparisonId: string, caseKind: ComparisonCase["kind"], variant: ComparisonVariant): string {
    const experimentsRoot = resolve(this.config.dataDir, "experiments");
    const worktreePath = resolve(experimentsRoot, comparisonId, `${caseKind}-${variant}`);
    const allowedPrefix = `${experimentsRoot}${sep}`.toLowerCase();
    if (!worktreePath.toLowerCase().startsWith(allowedPrefix)) {
      throw new Error("Experiment worktree escaped the product data directory");
    }
    return worktreePath;
  }
}

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ContentStore } from "./content-store.js";
import { EvolutionService, replaceFileAtomically } from "./evolution-service.js";
import { WorkbenchStore } from "./store.js";

function fixture() {
  const scratchRoot = process.env.REW_TEST_TMP ?? tmpdir();
  mkdirSync(scratchRoot, { recursive: true });
  const root = mkdtempSync(join(scratchRoot, "rew-evolution-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const target = join(workspace, "AGENTS.md");
  writeFileSync(target, "# Rules\n\n- Verify the result.\n", "utf8");
  const store = new WorkbenchStore(join(root, "workbench.sqlite3"));
  const originalRun = store.ensureRun({ sessionId: "original-failure", mode: "observed", goal: "Failed case", cwd: workspace });
  const protectionRun = store.ensureRun({ sessionId: "protection-case", mode: "observed", goal: "Protection case", cwd: workspace });
  const issue = store.createIssue({
    title: "Verification instruction was skipped",
    summary: "The Run stopped before checking the real output.",
    category: "instruction",
    evidence: [{ runId: originalRun.id, note: "No verifier event was retained." }]
  });
  const contentStore = new ContentStore(join(root, "content"));
  return {
    root,
    workspace,
    target,
    store,
    contentStore,
    service: new EvolutionService(store, contentStore),
    originalRun,
    protectionRun,
    issue
  };
}

describe("EvolutionService", () => {
  it("publishes only after approval and restores the exact original when unchanged", () => {
    const value = fixture();
    try {
      const candidate = "# Rules\n\n- Verify the result against the user-visible target before declaring completion.\n";
      const proposal = value.service.createProposal({
        issueId: value.issue.id,
        workspaceRoot: value.workspace,
        targetPath: "AGENTS.md",
        targetKind: "agents",
        candidateContent: candidate,
        rationale: "The failure Run lacked result verification; the protection Run preserves normal repository work.",
        originalRunId: value.originalRun.id,
        protectionRunId: value.protectionRun.id
      });
      expect(() => value.service.publish(proposal.id)).toThrow("explicit approval");
      addSupportedComparison(value.store, proposal.id);
      value.service.approve(proposal.id);
      expect(value.service.publish(proposal.id).status).toBe("applied");
      expect(readFileSync(value.target, "utf8")).toBe(candidate);
      expect(value.service.rollback(proposal.id).status).toBe("applied");
      expect(readFileSync(value.target, "utf8")).toBe("# Rules\n\n- Verify the result.\n");
    } finally {
      value.store.close();
      rmSync(value.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("does not overwrite later user edits during publish or rollback", () => {
    const value = fixture();
    try {
      const proposal = value.service.createProposal({
        issueId: value.issue.id,
        workspaceRoot: value.workspace,
        targetPath: "AGENTS.md",
        targetKind: "agents",
        candidateContent: "# Rules\n\n- Run the verifier before completion.\n",
        rationale: "Evidence-backed verification reminder.",
        originalRunId: value.originalRun.id,
        protectionRunId: value.protectionRun.id
      });
      addSupportedComparison(value.store, proposal.id);
      value.service.approve(proposal.id);
      writeFileSync(value.target, "# Rules\n\n- User changed this concurrently.\n", "utf8");
      const publishConflict = value.service.publish(proposal.id);
      expect(publishConflict.status).toBe("conflict");
      expect(readFileSync(value.target, "utf8")).toContain("User changed");

      writeFileSync(value.target, "# Rules\n\n- Verify the result.\n", "utf8");
      expect(value.service.publish(proposal.id).status).toBe("applied");
      writeFileSync(value.target, "# Rules\n\n- Candidate plus a later user edit.\n", "utf8");
      const rollbackConflict = value.service.rollback(proposal.id);
      expect(rollbackConflict.status).toBe("conflict");
      expect(rollbackConflict.currentContentRef).toMatch(/^sha256:/);
      expect(readFileSync(value.target, "utf8")).toContain("later user edit");
    } finally {
      value.store.close();
      rmSync(value.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("preserves the target on write failure and on a last-moment concurrent edit", () => {
    const value = fixture();
    try {
      const candidate = "# Rules\n\n- Verify atomically.\n";
      const proposal = value.service.createProposal({
        issueId: value.issue.id,
        workspaceRoot: value.workspace,
        targetPath: "AGENTS.md",
        targetKind: "agents",
        candidateContent: candidate,
        rationale: "Protect capability files from partial writes and concurrent edits.",
        originalRunId: value.originalRun.id,
        protectionRunId: value.protectionRun.id
      });
      addSupportedComparison(value.store, proposal.id);
      value.service.approve(proposal.id);

      const failingService = new EvolutionService(value.store, value.contentStore, () => {
        throw new Error("synthetic disk write failure");
      });
      expect(() => failingService.publish(proposal.id)).toThrow("Atomic publication failed");
      expect(readFileSync(value.target, "utf8")).toBe("# Rules\n\n- Verify the result.\n");

      const concurrentService = new EvolutionService(value.store, value.contentStore, (input) => {
        writeFileSync(value.target, "# Rules\n\n- Last-moment user edit.\n", "utf8");
        return replaceFileAtomically(input);
      });
      expect(concurrentService.publish(proposal.id).status).toBe("conflict");
      expect(readFileSync(value.target, "utf8")).toContain("Last-moment user edit");
      expect(
        readdirSync(value.workspace).some((name) => name.includes("runtime-evolution") && name.endsWith(".tmp"))
      ).toBe(false);
    } finally {
      value.store.close();
      rmSync(value.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("reconciles publication after a crash immediately following atomic replacement", () => {
    const value = fixture();
    try {
      const candidate = "# Rules\n\n- Recover an interrupted publish.\n";
      const proposal = value.service.createProposal({
        issueId: value.issue.id,
        workspaceRoot: value.workspace,
        targetPath: "AGENTS.md",
        targetKind: "agents",
        candidateContent: candidate,
        rationale: "Recover publication metadata after an interrupted commit.",
        originalRunId: value.originalRun.id,
        protectionRunId: value.protectionRun.id
      });
      addSupportedComparison(value.store, proposal.id);
      value.service.approve(proposal.id);
      const interruptedService = new EvolutionService(value.store, value.contentStore, (input) => {
        replaceFileAtomically(input);
        throw new Error("synthetic process interruption after replacement");
      });
      expect(() => interruptedService.publish(proposal.id)).toThrow("Atomic publication failed");
      expect(readFileSync(value.target, "utf8")).toBe(candidate);
      expect(value.service.publish(proposal.id).status).toBe("applied");
      expect(value.store.getProposal(proposal.id)?.status).toBe("published");
    } finally {
      value.store.close();
      rmSync(value.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

function addSupportedComparison(store: WorkbenchStore, proposalId: string): void {
  const comparison = store.createComparison({
    proposalId,
    baseCommit: "0123456789abcdef0123456789abcdef01234567",
    cases: [
      { kind: "failure", name: "failure", prompt: "failure", verifierCommand: "fixture", verifierArgs: [], verifierTimeoutMs: 1_000 },
      { kind: "protection", name: "protection", prompt: "protection", verifierCommand: "fixture", verifierArgs: [], verifierTimeoutMs: 1_000 }
    ]
  });
  store.startComparison(comparison.id);
  const cases = store.listComparisonCases(comparison.id);
  for (const comparisonCase of cases) {
    for (const variant of ["baseline", "candidate"] as const) {
      const expectedFailure = comparisonCase.kind === "failure" && variant === "baseline";
      store.addComparisonRun({
        comparisonId: comparison.id,
        caseId: comparisonCase.id,
        variant,
        runId: null,
        verifierStatus: expectedFailure ? "fail" : "pass",
        verifierExitCode: expectedFailure ? 1 : 0,
        verifierOutputRef: null,
        patchRef: null,
        durationMs: 1,
        infrastructureError: ""
      });
    }
  }
  store.finishComparison(comparison.id, "completed", "Fixture supports candidate as single-run evidence.", "candidate_supported");
}

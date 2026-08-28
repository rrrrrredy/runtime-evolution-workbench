import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { WorkbenchStore } from "./store.js";

describe("startup recovery", () => {
  it("makes interrupted Runs and comparisons explicit instead of silently resuming", () => {
    const root = mkdtempSync(join(tmpdir(), "rew-recovery-"));
    const store = new WorkbenchStore(join(root, "workbench.sqlite3"));
    const failureRun = store.ensureRun({ sessionId: "failure", mode: "observed", goal: "failure" });
    const protectionRun = store.ensureRun({ sessionId: "protection", mode: "observed", goal: "protection" });
    const issue = store.createIssue({
      title: "Repeated miss",
      summary: "The same instruction was missed.",
      category: "instruction",
      evidence: [{ runId: failureRun.id, note: "Failed once" }]
    });
    const proposal = store.createProposalRecord({
      issueId: issue.id,
      workspaceRoot: root,
      targetPath: "AGENTS.md",
      targetKind: "agents",
      originalDigest: `sha256:${"0".repeat(64)}`,
      originalContentRef: `sha256:${"1".repeat(64)}`,
      candidateDigest: `sha256:${"2".repeat(64)}`,
      candidateContentRef: `sha256:${"3".repeat(64)}`,
      diffText: "+check",
      rationale: "Protect the missed instruction.",
      status: "ready",
      originalRunId: failureRun.id,
      protectionRunId: protectionRun.id
    });
    const comparison = store.createComparison({
      proposalId: proposal.id,
      baseCommit: "a".repeat(40),
      cases: [
        { kind: "failure", name: "failure", prompt: "fix", verifierCommand: "node", verifierArgs: [], verifierTimeoutMs: 1_000 },
        { kind: "protection", name: "protection", prompt: "protect", verifierCommand: "node", verifierArgs: [], verifierTimeoutMs: 1_000 }
      ]
    });
    store.startComparison(comparison.id);
    store.updateProposalStatus(proposal.id, "comparing");

    const now = "2026-08-28T10:00:00.000Z";
    const result = store.recoverInterruptedState(now);
    expect(result.runIds.sort()).toEqual([failureRun.id, protectionRun.id].sort());
    expect(result.comparisonIds).toEqual([comparison.id]);
    expect(store.getRun(failureRun.id)?.status).toBe("infrastructure_error");
    expect(store.getRunBundle(failureRun.id)?.gaps.some((gap) => gap.source === "startup-recovery")).toBe(true);
    expect(store.getComparison(comparison.id)).toMatchObject({
      status: "infrastructure_error",
      conclusion: "inconclusive"
    });
    expect(store.getProposal(proposal.id)?.status).toBe("ready");
    expect(store.recoverInterruptedState(now)).toEqual({ runIds: [], comparisonIds: [], proposalIds: [] });
    store.close();
  });
});

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ManagedRunRequest, ManagedRunResult, CodexAppServerAdapter } from "./app-server/adapter.js";
import { ComparisonService } from "./comparison-service.js";
import type { WorkbenchConfig } from "./config.js";
import { ContentStore } from "./content-store.js";
import { EvolutionService } from "./evolution-service.js";
import { WorkbenchStore } from "./store.js";

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
}

describe("ComparisonService", () => {
  it("runs exactly four isolated cells and labels the result as single-run evidence", async () => {
    const scratchRoot = process.env.REW_TEST_TMP ?? tmpdir();
    mkdirSync(scratchRoot, { recursive: true });
    const root = mkdtempSync(join(scratchRoot, "rew-comparison-"));
    const repository = join(root, "repository");
    const dataDir = join(root, "data");
    mkdirSync(repository);
    mkdirSync(dataDir);
    writeFileSync(join(repository, "AGENTS.md"), "# Rules\n\n- Keep changes small.\n", "utf8");
    writeFileSync(
      join(repository, "verify.mjs"),
      "import { readFileSync } from 'node:fs';\nprocess.exit(readFileSync('result.txt', 'utf8').trim() === 'pass' ? 0 : 1);\n",
      "utf8"
    );
    runGit(repository, ["init"]);
    runGit(repository, ["add", "AGENTS.md", "verify.mjs"]);
    runGit(repository, ["-c", "user.name=REW Test", "-c", "user.email=rew@example.invalid", "commit", "-m", "fixture"]);

    const store = new WorkbenchStore(join(dataDir, "workbench.sqlite3"));
    try {
      const contentStore = new ContentStore(join(dataDir, "content"));
      const originalRun = store.ensureRun({ sessionId: "comparison-original", mode: "observed", goal: "Failure case", cwd: repository });
      const protectionRun = store.ensureRun({ sessionId: "comparison-protection", mode: "observed", goal: "Protection case", cwd: repository });
      const issue = store.createIssue({
        title: "Sentinel instruction missing",
        summary: "The failure case needs one bounded instruction.",
        category: "instruction",
        evidence: [{ runId: originalRun.id, note: "Failure verifier did not pass." }]
      });
      const proposal = new EvolutionService(store, contentStore).createProposal({
        issueId: issue.id,
        workspaceRoot: repository,
        targetPath: "AGENTS.md",
        targetKind: "agents",
        candidateContent: "# Rules\n\n- Keep changes small.\n- Fix sentinel failures before completion.\n",
        rationale: "The added line is scoped to the observed failure.",
        originalRunId: originalRun.id,
        protectionRunId: protectionRun.id
      });

      const fakeAdapter = {
        async runManaged(input: ManagedRunRequest): Promise<ManagedRunResult> {
          const instructions = readFileSync(join(input.cwd, "AGENTS.md"), "utf8");
          const passes = input.prompt.includes("protection") || instructions.includes("Fix sentinel failures");
          writeFileSync(join(input.cwd, "result.txt"), passes ? "pass\n" : "fail\n", "utf8");
          const run = store.ensureRun({
            sessionId: randomUUID(),
            mode: "managed",
            goal: input.prompt,
            cwd: input.cwd,
            status: "running",
            completeness: "partial"
          });
          store.updateRunTerminal(run.id, "completed");
          const bundle = store.getRunBundle(run.id);
          if (bundle === null) throw new Error("Fixture Run missing");
          return { bundle, agentMessage: "fixture" };
        }
      } as CodexAppServerAdapter;

      const config: WorkbenchConfig = {
        host: "127.0.0.1",
        port: 43119,
        dataDir,
        databasePath: join(dataDir, "workbench.sqlite3"),
        contentDir: join(dataDir, "content"),
        spoolPendingDir: join(dataDir, "spool", "pending"),
        spoolArchiveDir: join(dataDir, "spool", "archive"),
        spoolRejectedDir: join(dataDir, "spool", "rejected"),
        tokenPath: join(dataDir, "session-token"),
        codexExecutable: "codex",
        webRoot: join(dataDir, "web")
      };
      const service = new ComparisonService(config, store, contentStore, fakeAdapter);
      const comparison = await service.create(proposal.id, [
        {
          kind: "failure",
          name: "Original failure",
          prompt: "Handle the sentinel failure.",
          verifierCommand: process.execPath,
          verifierArgs: ["verify.mjs"]
        },
        {
          kind: "protection",
          name: "Neighbor protection",
          prompt: "Run the protection behavior.",
          verifierCommand: process.execPath,
          verifierArgs: ["verify.mjs"]
        }
      ]);
      const result = await service.run(comparison.id);
      expect(result.runs).toHaveLength(4);
      expect(result.comparison.conclusion).toBe("candidate_supported");
      expect(result.comparison.singleRunEvidence).toBe(true);
      expect(result.runs.every((entry) => entry.runId !== null)).toBe(true);
      expect(runGit(repository, ["worktree", "list", "--porcelain"]).match(/^worktree /gm)).toHaveLength(1);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }, 30_000);
});

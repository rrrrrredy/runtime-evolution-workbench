import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { CodexAppServerAdapter } from "../dist/server/app-server/adapter.js";
import { ComparisonService } from "../dist/server/comparison-service.js";
import { ContentStore } from "../dist/server/content-store.js";
import { EvolutionService } from "../dist/server/evolution-service.js";
import { ensureWorkbenchDataRoot } from "../dist/server/config.js";
import { HookIngestor } from "../dist/server/hook-ingestor.js";
import { AgentRunExporter } from "../dist/server/protocol-export.js";
import { WorkbenchStore } from "../dist/server/store.js";

const ORIGINAL_CAPABILITY = "# Rules\n\n- Keep changes small.\n";
const CANDIDATE_CAPABILITY = [
  "# Rules",
  "",
  "- Keep changes small.",
  "- When a user asks to apply the `sentinel-output` policy, create `result.txt` at the repository root containing exactly `pass` followed by a newline. Do not edit any other file.",
  ""
].join("\n");
const VERIFY_RESULT_SCRIPT = "const fs=require('node:fs');let value='';try{value=fs.readFileSync('result.txt','utf8').trim()}catch{}process.exit(value===process.argv[1]?0:1);";

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const defaultGateRoot = resolve(process.cwd(), "..", "_tmp");
const dataDir = resolve(process.env.REW_GATE_DATA_DIR ?? join(defaultGateRoot, `rew-product-gate-${stamp}`));
ensureWorkbenchDataRoot(dataDir);
const codexExecutable = process.env.CODEX_EXECUTABLE ?? "codex";
const gateOutput = process.env.REW_GATE_OUTPUT;
const config = {
  host: "127.0.0.1",
  port: 43119,
  dataDir,
  databasePath: join(dataDir, "workbench.sqlite3"),
  contentDir: join(dataDir, "content"),
  spoolPendingDir: join(dataDir, "spool", "pending"),
  spoolArchiveDir: join(dataDir, "spool", "archive"),
  spoolRejectedDir: join(dataDir, "spool", "rejected"),
  tokenPath: join(dataDir, "session-token"),
  codexExecutable,
  webRoot: join(dataDir, "web")
};
for (const directory of [config.contentDir, config.spoolPendingDir, config.spoolArchiveDir, config.spoolRejectedDir]) {
  mkdirSync(directory, { recursive: true });
}

const store = new WorkbenchStore(config.databasePath);
const contentStore = new ContentStore(config.contentDir);
const ingestor = new HookIngestor(config, store, contentStore);
const adapter = new CodexAppServerAdapter(codexExecutable, store, contentStore);
const exporter = new AgentRunExporter(store);
const comparisons = new ComparisonService(config, store, contentStore, adapter);
const evolution = new EvolutionService(store, contentStore);
const repository = join(dataDir, "gate-repository");
const seedWorktrees = new Set();

function invokeHook(sessionId, hookEventName, extra = {}) {
  const payload = {
    session_id: sessionId,
    turn_id: extra.turn_id ?? null,
    hook_event_name: hookEventName,
    cwd: process.cwd(),
    model: "gate-model",
    permission_mode: "read-only",
    ...extra
  };
  const result = spawnSync(
    process.execPath,
    [resolve("plugins/runtime-evolution-workbench/scripts/capture-hook.mjs")],
    {
      cwd: process.cwd(),
      input: JSON.stringify(payload),
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, REW_DATA_DIR: dataDir }
    }
  );
  if (result.status !== 0) throw new Error(`Hook process failed: ${result.stderr}`);
}

function runChecked(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

function runGit(cwd, args) {
  return runChecked("git", args, cwd);
}

function objectiveStatus(cwd, expected) {
  const result = spawnSync(process.execPath, ["-e", VERIFY_RESULT_SCRIPT, expected], {
    cwd,
    encoding: "utf8",
    windowsHide: true
  });
  if (result.error || result.status === null) {
    throw new Error(`Objective verifier could not run: ${result.error?.message ?? "no exit status"}`);
  }
  return result.status === 0 ? "pass" : "fail";
}

function removeSeedWorktree(worktreePath, strict) {
  const result = spawnSync("git", ["-C", repository, "worktree", "remove", "--force", worktreePath], {
    cwd: repository,
    encoding: "utf8",
    windowsHide: true
  });
  const absent = /not a working tree|is not a working tree|does not exist/i.test(`${result.stdout}\n${result.stderr}`);
  if (result.status !== 0 && !absent && strict) {
    throw new Error(`Seed worktree cleanup failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  if (result.status === 0 || absent) seedWorktrees.delete(worktreePath);
  spawnSync("git", ["-C", repository, "worktree", "prune"], { cwd: repository, encoding: "utf8", windowsHide: true });
}

async function runSeed(kind, prompt, expected) {
  const worktreePath = join(dataDir, "seed-worktrees", kind);
  mkdirSync(join(dataDir, "seed-worktrees"), { recursive: true });
  runGit(repository, ["worktree", "add", "--detach", worktreePath, "HEAD"]);
  seedWorktrees.add(worktreePath);
  try {
    const managed = await adapter.runManaged({
      cwd: worktreePath,
      prompt,
      sandbox: "workspace-write",
      effort: "low",
      timeoutMs: 120_000
    });
    const verifierStatus = objectiveStatus(worktreePath, expected);
    store.updateOutcome(
      managed.bundle.run.id,
      verifierStatus === "pass" ? "success" : "failure",
      `Release-gate objective verifier ${verifierStatus}.`
    );
    return {
      runId: managed.bundle.run.id,
      runStatus: managed.bundle.run.status,
      verifierStatus,
      document: exporter.export(managed.bundle.run.id)
    };
  } finally {
    removeSeedWorktree(worktreePath, true);
  }
}

function worktreeCount() {
  return (runGit(repository, ["worktree", "list", "--porcelain"]).match(/^worktree /gm) ?? []).length;
}

try {
  const observedSession = `gate-observed-${randomUUID()}`;
  invokeHook(observedSession, "SessionStart");
  invokeHook(observedSession, "UserPromptSubmit", { turn_id: "gate-turn", prompt: "Preserve this ordinary Run for the product gate." });
  invokeHook(observedSession, "SessionEnd");
  const ingestion = ingestor.processPending();
  const observed = store.getRunBySessionId(observedSession);
  if (observed === null) throw new Error("Observed hook Run was not retained");
  const observedDocument = exporter.export(observed.id);

  const threads = await adapter.listThreads(5);
  const storedThreadId = typeof threads[0]?.id === "string" ? threads[0].id : null;
  const backfill = storedThreadId === null ? null : await adapter.backfillThread(storedThreadId);
  if (backfill !== null) exporter.export(backfill.run.id);

  mkdirSync(repository, { recursive: true });
  writeFileSync(join(repository, "AGENTS.md"), ORIGINAL_CAPABILITY, "utf8");
  runGit(repository, ["init"]);
  runGit(repository, ["add", "AGENTS.md"]);
  runGit(repository, [
    "-c", "user.name=Runtime Evolution Gate",
    "-c", "user.email=runtime-evolution-gate@example.invalid",
    "commit", "-m", "release gate fixture"
  ]);
  await adapter.preflightManagedWorkspace(repository);

  const failureSeed = await runSeed(
    "failure",
    "Apply the repository's sentinel-output policy now. Complete the requested workspace change and do not ask follow-up questions.",
    "pass"
  );
  const protectionSeed = await runSeed(
    "protection",
    "Create result.txt at the repository root containing exactly protect followed by a newline. Do not edit any other file.",
    "protect"
  );
  if (
    failureSeed.runStatus !== "completed"
      || failureSeed.verifierStatus !== "fail"
      || protectionSeed.runStatus !== "completed"
      || protectionSeed.verifierStatus !== "pass"
  ) {
    throw new Error(
      `Seed evidence failed before comparison: failure=${failureSeed.runStatus}/${failureSeed.verifierStatus}, protection=${protectionSeed.runStatus}/${protectionSeed.verifierStatus}`
    );
  }
  const correction = store.addCorrection({
    runId: failureSeed.runId,
    kind: "instruction",
    text: "The repository needs a bounded sentinel-output instruction; do not generalize this failure to unrelated file tasks.",
    targetEventIds: [],
    redacted: false
  });

  const issue = store.createIssue({
    title: "Repository capability does not define sentinel-output",
    summary: "The failure verifier did not observe the required output, while the neighboring explicit file task succeeded.",
    category: "instruction",
    status: "confirmed",
    suggestedTarget: "AGENTS.md",
    counterEvidence: "A distinct protection Run completed an explicitly specified file task without the proposed policy.",
    evidence: [
      { runId: failureSeed.runId, note: "Objective failure verifier returned fail." },
      { runId: protectionSeed.runId, note: "Neighboring protection verifier returned pass." }
    ]
  });
  const proposal = evolution.createProposal({
    issueId: issue.id,
    workspaceRoot: repository,
    targetPath: "AGENTS.md",
    targetKind: "agents",
    candidateContent: CANDIDATE_CAPABILITY,
    rationale: "The candidate adds one bounded repository behavior supported by the failed Run and preserves a distinct explicit file task.",
    originalRunId: failureSeed.runId,
    protectionRunId: protectionSeed.runId
  });

  const comparison = await comparisons.create(proposal.id, [
    {
      kind: "failure",
      name: "Missing sentinel-output behavior",
      prompt: "Apply the repository's sentinel-output policy now. Complete the requested workspace change and do not ask follow-up questions.",
      verifierCommand: process.execPath,
      verifierArgs: ["-e", VERIFY_RESULT_SCRIPT, "pass"],
      verifierTimeoutMs: 30_000
    },
    {
      kind: "protection",
      name: "Explicit neighboring file task",
      prompt: "Create result.txt at the repository root containing exactly protect followed by a newline. Do not edit any other file.",
      verifierCommand: process.execPath,
      verifierArgs: ["-e", VERIFY_RESULT_SCRIPT, "protect"],
      verifierTimeoutMs: 30_000
    }
  ]);
  const comparisonDetail = await comparisons.run(comparison.id);
  const caseById = new Map(comparisonDetail.cases.map((entry) => [entry.id, entry]));
  const cell = (kind, variant) => comparisonDetail.runs.find(
    (entry) => caseById.get(entry.caseId)?.kind === kind && entry.variant === variant
  )?.verifierStatus ?? "missing";
  const matrix = {
    failureBaseline: cell("failure", "baseline"),
    failureCandidate: cell("failure", "candidate"),
    protectionBaseline: cell("protection", "baseline"),
    protectionCandidate: cell("protection", "candidate")
  };
  if (
    comparisonDetail.comparison.status !== "completed"
      || comparisonDetail.comparison.conclusion !== "candidate_supported"
  ) {
    throw new Error(
      `Four-cell comparison did not support approval: status=${comparisonDetail.comparison.status}, conclusion=${comparisonDetail.comparison.conclusion}, matrix=${JSON.stringify(matrix)}`
    );
  }

  const approved = evolution.approve(proposal.id);
  const publishEvent = evolution.publish(proposal.id);
  const candidatePublished = readFileSync(join(repository, "AGENTS.md"), "utf8") === CANDIDATE_CAPABILITY;
  const laterUserEdit = `${CANDIDATE_CAPABILITY}\n<!-- later user edit retained by the gate -->\n`;
  writeFileSync(join(repository, "AGENTS.md"), laterUserEdit, "utf8");
  const rollbackConflict = evolution.rollback(proposal.id);
  const conflictPreserved = readFileSync(join(repository, "AGENTS.md"), "utf8") === laterUserEdit;
  writeFileSync(join(repository, "AGENTS.md"), CANDIDATE_CAPABILITY, "utf8");
  const rollbackEvent = evolution.rollback(proposal.id);
  const originalRestored = readFileSync(join(repository, "AGENTS.md"), "utf8") === ORIGINAL_CAPABILITY;

  const comparisonRunIds = comparisonDetail.runs.map((entry) => entry.runId).filter((entry) => entry !== null);
  const managedRunIds = [failureSeed.runId, protectionSeed.runId, ...comparisonRunIds];
  const managedDocuments = managedRunIds.map((runId) => exporter.export(runId));
  const managedRuns = managedRunIds.map((runId) => store.getRun(runId));
  const codexVersionProbe = spawnSync(codexExecutable, ["--version"], { encoding: "utf8", windowsHide: true });
  if (codexVersionProbe.status !== 0) throw new Error("Codex version probe failed");
  const testedCommit = runGit(process.cwd(), ["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/.test(testedCommit)) {
    throw new Error("Runtime product gate must run from a committed Git checkout");
  }

  const result = {
    schemaVersion: "product.runtime-evolution-gate.v2",
    product: "runtime-evolution-workbench",
    version: "0.1.0",
    nodeVersion: process.versions.node,
    codexVersion: (codexVersionProbe.stdout || codexVersionProbe.stderr).trim(),
    testedCommit,
    observed: {
      retained: true,
      ingestedFiles: ingestion.filter((entry) => entry.status === "ingested").length,
      eventCount: observedDocument.events.length,
      completeness: observedDocument.capture.completeness,
      hasAppServerGap: observedDocument.capture.gaps.some((gap) => gap.source === "codex-app-server")
    },
    storedBackfill: backfill === null ? { available: false } : {
      available: true,
      insertedEvents: backfill.insertedEvents,
      omittedReasoningItems: backfill.omittedReasoningItems,
      mappingLossDeclared: backfill.mappingLossDeclared
    },
    managed: {
      sourceWorkspacePreflight: true,
      runCount: managedRunIds.length,
      allCompleted: managedRuns.every((run) => run?.status === "completed"),
      minimumEventCount: Math.min(...managedDocuments.map((document) => document.events.length)),
      allHaveLiveStructuredEvents: managedDocuments.every(
        (document) => document.events.some((event) => event.source === "codex-app-server-live")
      ),
      allDeclareReasoningExclusion: managedDocuments.every(
        (document) => document.capture.gaps.some((gap) => gap.kind === "excluded")
      )
    },
    evolution: {
      initialFailureCompleted: failureSeed.runStatus === "completed",
      initialFailureVerifier: failureSeed.verifierStatus,
      protectionCompleted: protectionSeed.runStatus === "completed",
      protectionVerifier: protectionSeed.verifierStatus,
      issueCategory: issue.category,
      issueEvidenceCount: issue.evidenceCount,
      correctionKind: correction.kind,
      correctionRetained: store.getRunBundle(failureSeed.runId)?.corrections.some((entry) => entry.id === correction.id) ?? false,
      distinctEvidenceRuns: failureSeed.runId !== protectionSeed.runId,
      proposalTarget: proposal.targetPath,
      proposalDiffPresent: proposal.diffText.length > 0,
      comparisonStatus: comparisonDetail.comparison.status,
      comparisonConclusion: comparisonDetail.comparison.conclusion,
      comparisonCells: comparisonDetail.runs.length,
      ...matrix,
      singleRunEvidence: comparisonDetail.comparison.singleRunEvidence,
      allCellsHaveRunIds: comparisonDetail.runs.every((entry) => entry.runId !== null),
      noInfrastructureErrors: comparisonDetail.runs.every((entry) => entry.infrastructureError.length === 0),
      approvalStatus: approved.status,
      publishApplied: publishEvent.status === "applied" && candidatePublished,
      rollbackConflict: rollbackConflict.status === "conflict",
      conflictPreserved,
      rollbackApplied: rollbackEvent.status === "applied",
      originalRestored,
      finalProposalStatus: store.getProposal(proposal.id)?.status ?? "missing",
      sourceRepositoryClean: runGit(repository, ["status", "--porcelain"]).length === 0,
      worktreesRemoved: worktreeCount() === 1
    }
  };

  const gateFailures = [];
  if (result.observed.ingestedFiles < 3) gateFailures.push("ordinary Hook lifecycle was not fully ingested");
  if (result.observed.eventCount < 3) gateFailures.push("ordinary Run retained too few events");
  if (!result.observed.hasAppServerGap) gateFailures.push("ordinary Run did not declare its App Server observation gap");
  if (result.storedBackfill.available && !result.storedBackfill.mappingLossDeclared) gateFailures.push("stored Thread backfill did not declare mapping loss");
  if (result.managed.runCount !== 6) gateFailures.push("the evolution closure did not retain exactly six real managed Runs");
  if (!result.managed.sourceWorkspacePreflight) gateFailures.push("the bounded App Server workspace preflight did not pass");
  if (!result.managed.allCompleted) gateFailures.push("at least one managed Run did not complete");
  if (result.managed.minimumEventCount < 2) gateFailures.push("at least one managed Run retained too few structured events");
  if (!result.managed.allHaveLiveStructuredEvents) gateFailures.push("at least one managed Run retained no live App Server events");
  if (!result.managed.allDeclareReasoningExclusion) gateFailures.push("at least one managed Run did not declare the reasoning exclusion");
  if (!result.evolution.initialFailureCompleted || result.evolution.initialFailureVerifier !== "fail") gateFailures.push("the original failure Run was not objectively reproduced");
  if (!result.evolution.protectionCompleted || result.evolution.protectionVerifier !== "pass") gateFailures.push("the distinct protection Run did not objectively pass");
  if (result.evolution.correctionKind !== "instruction" || !result.evolution.correctionRetained) gateFailures.push("the user correction was not retained with the failure Run");
  if (result.evolution.issueCategory !== "instruction" || result.evolution.issueEvidenceCount < 2 || !result.evolution.distinctEvidenceRuns) gateFailures.push("the Issue lacks distinct failure and protection evidence");
  if (result.evolution.proposalTarget !== "AGENTS.md" || !result.evolution.proposalDiffPresent) gateFailures.push("the bounded capability proposal was not created");
  if (result.evolution.comparisonStatus !== "completed" || result.evolution.comparisonConclusion !== "candidate_supported") gateFailures.push("the four-cell comparison did not support the candidate");
  if (result.evolution.comparisonCells !== 4 || !result.evolution.singleRunEvidence || !result.evolution.allCellsHaveRunIds || !result.evolution.noInfrastructureErrors) gateFailures.push("the comparison evidence was incomplete or mislabeled");
  if (result.evolution.failureBaseline !== "fail" || result.evolution.failureCandidate !== "pass" || result.evolution.protectionBaseline !== "pass" || result.evolution.protectionCandidate !== "pass") gateFailures.push("the objective four-cell matrix was not fail/pass/pass/pass");
  if (result.evolution.approvalStatus !== "approved" || !result.evolution.publishApplied) gateFailures.push("manual approval and hash-safe publication were not exercised");
  if (!result.evolution.rollbackConflict || !result.evolution.conflictPreserved) gateFailures.push("rollback did not preserve a later user edit");
  if (!result.evolution.rollbackApplied || !result.evolution.originalRestored || result.evolution.finalProposalStatus !== "rolled_back") gateFailures.push("the exact original capability was not restored");
  if (!result.evolution.sourceRepositoryClean || !result.evolution.worktreesRemoved) gateFailures.push("the disposable repository or worktrees were not clean after the closure");
  if (gateFailures.length > 0) throw new Error(`Runtime product gate failed: ${gateFailures.join("; ")}`);

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (gateOutput) writeFileSync(resolve(gateOutput), `${JSON.stringify(result, null, 2)}\n`, "utf8");
} finally {
  for (const worktreePath of seedWorktrees) removeSeedWorktree(worktreePath, false);
  store.close();
}

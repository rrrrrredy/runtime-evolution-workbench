import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { CodexAppServerAdapter } from "../dist/server/app-server/adapter.js";
import { ContentStore } from "../dist/server/content-store.js";
import { HookIngestor } from "../dist/server/hook-ingestor.js";
import { AgentRunExporter } from "../dist/server/protocol-export.js";
import { WorkbenchStore } from "../dist/server/store.js";

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dataDir = resolve(process.env.REW_GATE_DATA_DIR ?? join(tmpdir(), `rew-product-gate-${stamp}`));
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
for (const directory of [config.contentDir, config.spoolPendingDir, config.spoolArchiveDir, config.spoolRejectedDir]) mkdirSync(directory, { recursive: true });

const store = new WorkbenchStore(config.databasePath);
const contentStore = new ContentStore(config.contentDir);
const ingestor = new HookIngestor(config, store, contentStore);
const adapter = new CodexAppServerAdapter(codexExecutable, store, contentStore);
const exporter = new AgentRunExporter(store);

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

  const managed = await adapter.runManaged({
    cwd: process.cwd(),
    prompt: "Reply with exactly MANAGED_PRODUCT_GATE_OK. Do not call tools and do not add punctuation.",
    sandbox: "read-only",
    effort: "low",
    timeoutMs: 90_000
  });
  const managedDocument = exporter.export(managed.bundle.run.id);
  const codexVersionProbe = spawnSync(codexExecutable, ["--version"], {
    encoding: "utf8",
    windowsHide: true
  });
  const commitProbe = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true
  });
  const testedCommit = commitProbe.stdout.trim();
  if (commitProbe.status !== 0 || !/^[0-9a-f]{40}$/.test(testedCommit)) {
    throw new Error("Runtime product gate must run from a committed Git checkout");
  }
  const result = {
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
      completed: managed.bundle.run.status === "completed",
      exactResponse: managed.agentMessage.trim() === "MANAGED_PRODUCT_GATE_OK",
      eventCount: managedDocument.events.length,
      liveStructuredEvents: managedDocument.events.some((event) => event.source === "codex-app-server-live"),
      reasoningExclusionDeclared: managedDocument.capture.gaps.some((gap) => gap.kind === "excluded")
    }
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const gateFailures = [];
  if (result.observed.ingestedFiles < 3) gateFailures.push("ordinary Hook lifecycle was not fully ingested");
  if (result.observed.eventCount < 3) gateFailures.push("ordinary Run retained too few events");
  if (!result.observed.hasAppServerGap) gateFailures.push("ordinary Run did not declare its App Server observation gap");
  if (result.storedBackfill.available && !result.storedBackfill.mappingLossDeclared) {
    gateFailures.push("stored Thread backfill did not declare mapping loss");
  }
  if (!result.managed.completed) gateFailures.push("managed Run did not complete");
  if (!result.managed.exactResponse) gateFailures.push("managed Run did not return the exact objective response");
  if (result.managed.eventCount < 2) gateFailures.push("managed Run retained too few structured events");
  if (!result.managed.liveStructuredEvents) gateFailures.push("managed Run retained no live App Server events");
  if (!result.managed.reasoningExclusionDeclared) gateFailures.push("managed Run did not declare the reasoning exclusion");
  if (gateFailures.length > 0) {
    throw new Error(`Runtime product gate failed: ${gateFailures.join("; ")}`);
  }
  if (gateOutput) {
    writeFileSync(resolve(gateOutput), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
} finally {
  store.close();
}

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ProtocolValidator } from "@runcase/interchange";
import { describe, expect, it } from "vitest";

import type { HookEnvelope } from "../shared/types.js";
import type { WorkbenchConfig } from "./config.js";
import { ContentStore } from "./content-store.js";
import { HookIngestor } from "./hook-ingestor.js";
import { AgentRunExporter } from "./protocol-export.js";
import { WorkbenchStore } from "./store.js";

function testConfig(root: string): WorkbenchConfig {
  const config: WorkbenchConfig = {
    host: "127.0.0.1",
    port: 43119,
    dataDir: root,
    databasePath: join(root, "workbench.sqlite3"),
    contentDir: join(root, "content"),
    spoolPendingDir: join(root, "spool", "pending"),
    spoolArchiveDir: join(root, "spool", "archive"),
    spoolRejectedDir: join(root, "spool", "rejected"),
    tokenPath: join(root, "session-token"),
    codexExecutable: "codex",
    webRoot: join(root, "web")
  };
  for (const directory of [config.contentDir, config.spoolPendingDir, config.spoolArchiveDir, config.spoolRejectedDir]) {
    mkdirSync(directory, { recursive: true });
  }
  return config;
}

function envelope(overrides: Partial<HookEnvelope>): HookEnvelope {
  return {
    schema_version: "rew.hook.v1",
    event_id: "event-default",
    session_id: "session-capture-test",
    turn_id: null,
    hook_event_name: "SessionStart",
    cwd: join(tmpdir(), "rew-fixture"),
    model: "configured-model",
    permission_mode: "workspace-write",
    received_at: "2026-08-28T01:00:00.000Z",
    payload: {},
    redaction: {
      status: "not_needed",
      redacted_field_count: 0,
      truncated_field_count: 0,
      patterns: []
    },
    ...overrides
  };
}

describe("local capture ledger", () => {
  it("deduplicates hooks, preserves explicit gaps, and exports valid agent.run.v1", () => {
    const scratchRoot = resolveTestScratch();
    mkdirSync(scratchRoot, { recursive: true });
    const root = mkdtempSync(join(scratchRoot, "rew-capture-"));
    const config = testConfig(root);
    const store = new WorkbenchStore(config.databasePath);
    try {
      const contentStore = new ContentStore(config.contentDir);
      const ingestor = new HookIngestor(config, store, contentStore);
      const start = envelope({ event_id: "start", hook_event_name: "SessionStart" });
      expect(ingestor.ingestEnvelope(start).inserted).toBe(true);
      expect(ingestor.ingestEnvelope(start).inserted).toBe(false);

      ingestor.ingestEnvelope(envelope({
        event_id: "prompt",
        turn_id: "turn-1",
        hook_event_name: "UserPromptSubmit",
        received_at: "2026-08-28T01:00:02.000Z",
        payload: { prompt: `Fix the parser without exposing ${["sk", "abcdefghijklmnop"].join("-")}` },
        redaction: {
          status: "applied",
          redacted_field_count: 1,
          truncated_field_count: 0,
          patterns: ["api-key"]
        }
      }));
      ingestor.ingestEnvelope(envelope({
        event_id: "late-tool",
        turn_id: "turn-1",
        hook_event_name: "PostToolUse",
        received_at: "2026-08-28T01:00:03.000Z",
        payload: { timestamp: "2026-08-28T00:59:59.000Z", tool_name: "shell", exit_code: 1 }
      }));
      const endResult = ingestor.ingestEnvelope(envelope({
        event_id: "end",
        hook_event_name: "SessionEnd",
        received_at: "2026-08-28T01:01:00.000Z"
      }));

      const bundle = store.getRunBundle(endResult.runId);
      expect(bundle?.run.status).toBe("completed");
      expect(bundle?.run.goal).toContain("Fix the parser");
      expect(bundle?.events).toHaveLength(4);
      expect(bundle?.gaps.some((gap) => gap.kind === "out_of_order")).toBe(true);
      expect(bundle?.gaps.some((gap) => gap.kind === "source_unavailable")).toBe(true);

      const exported = new AgentRunExporter(store).export(endResult.runId);
      expect(new ProtocolValidator().validate(exported).valid).toBe(true);
      expect(JSON.stringify(exported)).not.toContain(["sk", "abcdefghijklmnop"].join("-"));
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("stores identical content once by digest", () => {
    const scratchRoot = resolveTestScratch();
    mkdirSync(scratchRoot, { recursive: true });
    const root = mkdtempSync(join(scratchRoot, "rew-content-"));
    try {
      const contentStore = new ContentStore(root);
      const first = contentStore.put("same evidence");
      const second = contentStore.put("same evidence");
      expect(first.ref).toBe(second.ref);
      expect(contentStore.read(first.ref).toString("utf8")).toBe("same evidence");
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

function resolveTestScratch(): string {
  return process.env.REW_TEST_TMP ?? tmpdir();
}

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ProtocolImportService } from "./protocol-import.js";
import { WorkbenchStore } from "./store.js";

function workflowCase(): Record<string, unknown> {
  return {
    schema_version: "workflow.case.v1",
    case_id: "33333333-3333-4333-8333-333333333333",
    title: "Synthetic parser task",
    description: ["Bearer", "synthetic_protocol_token_123456"].join(" "),
    goal: {
      text: "Fix the parser and pass the focused test.",
      completion_summary: "The focused test passes."
    },
    variables: [],
    environment: {
      kind: "code",
      summary: "Synthetic repository in an isolated container.",
      build_ref: "dockerfile:synthetic",
      digest: `sha256:${"1".repeat(64)}`,
      initialize: [{ step_id: "initialize", kind: "container", executor_ref: "docker.create.v1", timeout_ms: 60_000 }],
      reset: [{ step_id: "reset", kind: "snapshot", executor_ref: "snapshot.restore.v1", timeout_ms: 30_000 }],
      health_checks: [{ step_id: "health", kind: "command", executor_ref: "command.exec.v1", timeout_ms: 5_000 }]
    },
    allowed_tools: [{ name: "shell", interface: "shell", scopes: ["/workspace"] }],
    validators: [{
      validator_id: "focused-test",
      name: "Focused regression test",
      kind: "test",
      objective: true,
      required: true,
      weight: 1,
      executor_ref: "command.exec.v1",
      assertion: { exit_code: 0 }
    }],
    provenance: {
      kind: "repository_issue",
      source_refs: [{ kind: "repository", ref: "urn:synthetic:repository" }],
      confirmed_by_user: true
    },
    safety: {
      network: "disabled",
      writable_paths: ["src"],
      denied_paths: [".env"],
      secret_refs: [],
      timeout_ms: 900_000,
      resource_limits: { cpu_count: 1, memory_mb: 512, disk_mb: 1024 }
    },
    created_at: "2026-08-28T00:00:00Z"
  };
}

describe("ProtocolImportService", () => {
  it("accepts a Factory Case, preserves structural fields, redacts inline secrets, and deduplicates it", () => {
    const scratchRoot = process.env.REW_TEST_TMP ?? tmpdir();
    mkdirSync(scratchRoot, { recursive: true });
    const root = mkdtempSync(join(scratchRoot, "rew-protocol-"));
    const store = new WorkbenchStore(join(root, "workbench.sqlite3"));
    try {
      const service = new ProtocolImportService(store);
      const first = service.importDocument(workflowCase());
      const duplicate = service.importDocument(workflowCase());

      expect(first.schemaVersion).toBe("workflow.case.v1");
      expect(first.externalId).toBe("33333333-3333-4333-8333-333333333333");
      expect(first.document.description).toBe("[REDACTED:bearer-token]");
      expect((first.document.safety as { secret_refs: unknown[] }).secret_refs).toEqual([]);
      expect(duplicate.id).toBe(first.id);
      expect(store.listProtocolDocuments()).toHaveLength(1);
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

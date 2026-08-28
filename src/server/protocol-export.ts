import { ProtocolValidator } from "@agent-run-protocol/core";

import type { StoredEvent, StoredRun } from "../shared/types.js";
import { WorkbenchStore } from "./store.js";

function protocolStatus(run: StoredRun): string {
  const statuses: Record<StoredRun["status"], string> = {
    running: "running",
    completed: "succeeded",
    failed: "failed",
    cancelled: "cancelled",
    agent_timeout: "agent_timeout",
    agent_crash: "agent_crash",
    infrastructure_error: "infrastructure_error"
  };
  return statuses[run.status];
}

function sourceRecord(source: string): Record<string, unknown> {
  if (source === "codex-hooks") {
    return { name: source, version: "1", status: "partial", details: "Lifecycle hooks are best effort and can arrive late or be missing." };
  }
  if (source === "codex-app-server-stored") {
    return { name: source, status: "partial", details: "Persisted Thread items are documented as potentially lossy." };
  }
  if (source === "codex-app-server-live") {
    return { name: source, status: "available", details: "Live structured notifications captured for a product-managed turn." };
  }
  return { name: source, status: "partial" };
}

function redactionSummary(events: StoredEvent[]): { status: string; patterns: string[]; count: number } {
  const patterns = new Set<string>();
  let count = 0;
  for (const event of events) {
    if (event.redacted) count += 1;
    const report = event.data.redaction;
    if (typeof report !== "object" || report === null || Array.isArray(report)) continue;
    const record = report as Record<string, unknown>;
    if (typeof record.redacted_field_count === "number") count += record.redacted_field_count;
    if (Array.isArray(record.patterns)) {
      for (const pattern of record.patterns) if (typeof pattern === "string") patterns.add(pattern);
    }
  }
  return { status: count > 0 ? "applied" : "not_needed", patterns: [...patterns].sort(), count };
}

export class AgentRunExporter {
  readonly #validator = new ProtocolValidator();

  constructor(readonly store: WorkbenchStore) {}

  export(runId: string): unknown {
    const bundle = this.store.getRunBundle(runId);
    if (bundle === null) throw new Error(`Run not found: ${runId}`);
    const { run, events, corrections } = bundle;
    const gaps = bundle.gaps.length > 0
      ? bundle.gaps
      : run.completeness === "partial"
        ? [{
            id: `implicit-${run.id}`,
            runId: run.id,
            kind: "unknown" as const,
            summary: "Capture was marked partial without a more specific retained gap.",
            source: null,
            startAt: null,
            endAt: null
          }]
        : [];
    const sources = [...new Set(events.map((event) => event.source))];
    if (sources.length === 0) sources.push(run.mode === "managed" ? "codex-app-server-live" : "codex-hooks");
    const redaction = redactionSummary(events);
    const duration = run.endedAt === null ? null : Math.max(0, Date.parse(run.endedAt) - Date.parse(run.startedAt));

    const document: Record<string, unknown> = {
      schema_version: "agent.run.v1",
      run_id: run.id,
      goal: { text: run.goal, source: "user" },
      agent: {
        product: run.agentProduct,
        adapter_version: "runtime-evolution-workbench/0.1.0",
        model_provider: "openai",
        ...(run.agentVersion === null ? {} : { product_version: run.agentVersion }),
        ...(run.model === null ? {} : { model: run.model })
      },
      configuration: {
        snapshot_id: run.configurationSnapshotId,
        files: [],
        working_directory: run.cwd,
        environment: { os: "windows", capture_product: "runtime-evolution-workbench" }
      },
      started_at: run.startedAt,
      ...(run.endedAt === null ? {} : { ended_at: run.endedAt }),
      status: protocolStatus(run),
      capture: {
        mode: run.mode,
        sources: sources.map(sourceRecord),
        completeness: run.completeness,
        gaps: gaps.map((gap) => ({
          gap_id: gap.id,
          kind: gap.kind,
          summary: gap.summary,
          ...(gap.startAt === null ? {} : { start_at: gap.startAt }),
          ...(gap.endAt === null ? {} : { end_at: gap.endAt }),
          ...(gap.source === null ? {} : { source: gap.source })
        })),
        redaction: {
          status: redaction.status,
          secret_patterns_applied: redaction.patterns,
          excluded_paths: [],
          redacted_field_count: redaction.count
        }
      },
      events: events.map((event) => ({
        event_id: event.id,
        ...(event.sequence === null ? {} : { sequence: event.sequence }),
        timestamp: event.timestamp,
        received_at: event.receivedAt,
        type: event.type,
        source: event.source,
        summary: event.summary,
        data: event.data,
        content_refs: event.contentRefs,
        redacted: event.redacted
      })),
      artifacts: [],
      outcome: {
        status: run.outcomeStatus,
        summary: run.outcomeSummary,
        verifier_refs: []
      },
      user_corrections: corrections.map((correction) => ({
        correction_id: correction.id,
        created_at: correction.createdAt,
        kind: correction.kind,
        text: correction.text,
        target_event_ids: correction.targetEventIds,
        redacted: correction.redacted
      })),
      ...(duration === null ? {} : { resource_usage: { duration_ms: duration } }),
      extensions: {
        "runtime-evolution-workbench.thread_id": run.threadId,
        "runtime-evolution-workbench.evidence_boundary": run.mode === "managed" ? "live-structured-with-explicit-exclusions" : "best-effort-observed"
      }
    };

    const validation = this.#validator.validate(document, "agent.run.v1");
    if (!validation.valid) {
      throw new Error(`Generated agent.run.v1 failed validation: ${JSON.stringify(validation.errors)}`);
    }
    return document;
  }
}

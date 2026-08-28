import { mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { basename, join } from "node:path";

import { z } from "zod";

import { stableUuid } from "../shared/ids.js";
import type { HookEnvelope } from "../shared/types.js";
import { ContentStore } from "./content-store.js";
import type { WorkbenchConfig } from "./config.js";
import { redactUnknown } from "./redaction.js";
import { WorkbenchStore } from "./store.js";

const hookEnvelopeSchema = z.object({
  schema_version: z.literal("rew.hook.v1"),
  event_id: z.string().min(1),
  session_id: z.string().min(1),
  turn_id: z.string().min(1).nullable(),
  hook_event_name: z.string().min(1),
  cwd: z.string(),
  model: z.string().min(1).nullable(),
  permission_mode: z.string().min(1).nullable(),
  received_at: z.iso.datetime(),
  payload: z.record(z.string(), z.unknown()),
  redaction: z.object({
    status: z.enum(["not_needed", "applied", "partial", "unknown"]),
    redacted_field_count: z.number().int().nonnegative(),
    truncated_field_count: z.number().int().nonnegative(),
    patterns: z.array(z.string())
  })
});

function eventType(hookName: string): string {
  const known: Record<string, string> = {
    SessionStart: "session.started",
    SessionEnd: "session.ended",
    UserPromptSubmit: "user.prompt_submitted",
    PreToolUse: "tool.started",
    PostToolUse: "tool.completed",
    PermissionRequest: "permission.requested",
    PreCompact: "context.compaction_started",
    PostCompact: "context.compaction_completed",
    Stop: "turn.stopped",
    SubagentStart: "subagent.started",
    SubagentStop: "subagent.completed"
  };
  return known[hookName] ?? `hook.${hookName.replace(/([a-z])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").toLowerCase()}`;
}

function stringField(payload: Record<string, unknown>, names: string[]): string | null {
  for (const name of names) {
    const value = payload[name];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function summaryFor(envelope: HookEnvelope): string {
  const tool = stringField(envelope.payload, ["tool_name", "toolName", "tool"]);
  const summaries: Record<string, string> = {
    SessionStart: "Codex session started",
    SessionEnd: "Codex session ended",
    UserPromptSubmit: "User submitted a prompt",
    PreToolUse: tool === null ? "Tool use started" : `${tool} started`,
    PostToolUse: tool === null ? "Tool use completed" : `${tool} completed`,
    PermissionRequest: tool === null ? "Codex requested permission" : `${tool} requested permission`,
    PreCompact: "Context compaction started",
    PostCompact: "Context compaction completed",
    Stop: "Codex turn stopped",
    SubagentStart: "Subagent started",
    SubagentStop: "Subagent stopped"
  };
  return summaries[envelope.hook_event_name] ?? `Codex hook: ${envelope.hook_event_name}`;
}

function payloadTimestamp(envelope: HookEnvelope): string {
  const candidate = stringField(envelope.payload, ["timestamp", "created_at", "started_at"]);
  if (candidate !== null && !Number.isNaN(Date.parse(candidate))) return new Date(candidate).toISOString();
  return envelope.received_at;
}

function promptText(payload: Record<string, unknown>): string | null {
  return stringField(payload, ["prompt", "user_prompt", "userPrompt", "message", "text"]);
}

export interface IngestionResult {
  file: string;
  status: "ingested" | "duplicate" | "rejected";
  runId?: string;
  reason?: string;
}

export class HookIngestor {
  #timer: NodeJS.Timeout | null = null;
  #processing = false;

  constructor(
    readonly config: WorkbenchConfig,
    readonly store: WorkbenchStore,
    readonly contentStore: ContentStore
  ) {}

  ingestEnvelope(envelope: HookEnvelope): { inserted: boolean; runId: string } {
    const serverRedaction = redactUnknown(envelope.payload);
    const safeEnvelope: HookEnvelope = {
      ...envelope,
      payload: serverRedaction.value,
      redaction: {
        status: envelope.redaction.status === "partial" ? "partial" :
          envelope.redaction.status === "unknown" ? "unknown" :
            envelope.redaction.redacted_field_count + serverRedaction.redactedFieldCount > 0 ||
              envelope.redaction.truncated_field_count + serverRedaction.truncatedFieldCount > 0
              ? "applied"
              : "not_needed",
        redacted_field_count: envelope.redaction.redacted_field_count + serverRedaction.redactedFieldCount,
        truncated_field_count: envelope.redaction.truncated_field_count + serverRedaction.truncatedFieldCount,
        patterns: [...new Set([...envelope.redaction.patterns, ...serverRedaction.patterns])].sort()
      }
    };
    const timestamp = payloadTimestamp(safeEnvelope);
    const run = this.store.ensureRun({
      sessionId: safeEnvelope.session_id,
      mode: "observed",
      status: "running",
      cwd: safeEnvelope.cwd,
      model: safeEnvelope.model,
      ...(safeEnvelope.hook_event_name === "SessionStart" ? { startedAt: timestamp } : {}),
      completeness: "partial"
    });

    const previousTimestamp = this.store.latestEventTimestamp(run.id);
    const storedPayload = this.contentStore.putJson(safeEnvelope.payload);
    const inserted = this.store.addEvent({
      id: safeEnvelope.event_id,
      runId: run.id,
      turnId: safeEnvelope.turn_id,
      timestamp,
      receivedAt: safeEnvelope.received_at,
      type: eventType(safeEnvelope.hook_event_name),
      source: "codex-hooks",
      summary: summaryFor(safeEnvelope),
      data: {
        hook_event_name: safeEnvelope.hook_event_name,
        permission_mode: safeEnvelope.permission_mode,
        redaction: safeEnvelope.redaction,
        payload: safeEnvelope.payload
      },
      contentRefs: [storedPayload.ref],
      redacted: safeEnvelope.redaction.redacted_field_count > 0 || safeEnvelope.redaction.truncated_field_count > 0
    });

    if (!inserted) return { inserted: false, runId: run.id };

    this.store.addGap({
      id: stableUuid("runtime-evolution-workbench/gap", `${run.id}\0codex-app-server-unavailable`),
      runId: run.id,
      kind: "source_unavailable",
      summary: "No App Server backfill has been associated with this observed session yet.",
      source: "codex-app-server",
      startAt: null,
      endAt: null
    });

    if (previousTimestamp !== null && timestamp < previousTimestamp) {
      this.store.addGap({
        id: stableUuid("runtime-evolution-workbench/gap", `${run.id}\0out-of-order\0${safeEnvelope.event_id}`),
        runId: run.id,
        kind: "out_of_order",
        summary: `Hook ${safeEnvelope.hook_event_name} arrived after a later event.`,
        source: "codex-hooks",
        startAt: timestamp,
        endAt: previousTimestamp
      });
    }

    if (safeEnvelope.redaction.redacted_field_count > 0 || safeEnvelope.redaction.truncated_field_count > 0) {
      this.store.addGap({
        id: stableUuid("runtime-evolution-workbench/gap", `${run.id}\0redaction\0${safeEnvelope.event_id}`),
        runId: run.id,
        kind: "redacted",
        summary: "Sensitive or oversized hook content was removed before durable storage.",
        source: "codex-hooks",
        startAt: timestamp,
        endAt: timestamp
      });
    }

    if (safeEnvelope.hook_event_name === "UserPromptSubmit") {
      const goal = promptText(safeEnvelope.payload);
      if (goal !== null) this.store.updateRunGoal(run.id, goal);
    }
    if (safeEnvelope.hook_event_name === "SessionEnd") {
      this.store.updateRunTerminal(run.id, "completed", timestamp);
    }
    return { inserted: true, runId: run.id };
  }

  processPending(): IngestionResult[] {
    if (this.#processing) return [];
    this.#processing = true;
    const results: IngestionResult[] = [];
    try {
      const files = readdirSync(this.config.spoolPendingDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name)
        .sort();
      for (const fileName of files) {
        const sourcePath = join(this.config.spoolPendingDir, fileName);
        try {
          const parsed = hookEnvelopeSchema.safeParse(JSON.parse(readFileSync(sourcePath, "utf8")));
          if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
          const result = this.ingestEnvelope(parsed.data as HookEnvelope);
          const day = parsed.data.received_at.slice(0, 10);
          const archiveDirectory = join(this.config.spoolArchiveDir, day);
          mkdirSync(archiveDirectory, { recursive: true });
          renameSync(sourcePath, join(archiveDirectory, basename(sourcePath)));
          results.push({ file: fileName, status: result.inserted ? "ingested" : "duplicate", runId: result.runId });
        } catch (error) {
          mkdirSync(this.config.spoolRejectedDir, { recursive: true });
          const rejectedName = `${Date.now()}-${basename(sourcePath)}`;
          renameSync(sourcePath, join(this.config.spoolRejectedDir, rejectedName));
          results.push({
            file: fileName,
            status: "rejected",
            reason: error instanceof Error ? error.message : String(error)
          });
        }
      }
      return results;
    } finally {
      this.#processing = false;
    }
  }

  start(intervalMs = 750): void {
    this.processPending();
    this.#timer = setInterval(() => this.processPending(), intervalMs);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }
}

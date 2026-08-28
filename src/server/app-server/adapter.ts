import { stableUuid } from "../../shared/ids.js";
import type { RunStatus, StoredRun } from "../../shared/types.js";
import { ContentStore } from "../content-store.js";
import { redactUnknown } from "../redaction.js";
import { WorkbenchStore, type RunBundle } from "../store.js";
import { AppServerError, CodexAppServerClient } from "./client.js";

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isoFromUnixSeconds(value: unknown, fallback = new Date().toISOString()): string {
  const seconds = numberValue(value);
  return seconds === null ? fallback : new Date(seconds * 1000).toISOString();
}

function normalizeFragment(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .toLowerCase();
}

function itemSummary(item: JsonObject): string {
  const type = stringValue(item.type) ?? "unknown";
  if (type === "commandExecution") {
    const status = stringValue(item.status) ?? "unknown";
    const exitCode = numberValue(item.exitCode);
    return exitCode === null ? `Command ${status}` : `Command ${status} with exit code ${exitCode}`;
  }
  if (type === "mcpToolCall") return `MCP ${String(item.server ?? "unknown")}/${String(item.tool ?? "unknown")} ${String(item.status ?? "updated")}`;
  if (type === "fileChange") return `File change ${String(item.status ?? "updated")}`;
  if (type === "agentMessage") return "Codex produced an answer";
  if (type === "userMessage") return "User message recorded by App Server";
  if (type === "reasoning") return "Reasoning content intentionally omitted";
  return `${type} recorded by App Server`;
}

function turnStatusToRunStatus(status: unknown): RunStatus {
  if (status === "failed") return "failed";
  if (status === "interrupted") return "cancelled";
  if (status === "completed") return "completed";
  return "running";
}

function threadStatusType(status: unknown): string | null {
  return isObject(status) ? stringValue(status.type) : stringValue(status);
}

function itemId(item: JsonObject, fallback: string): string {
  return stringValue(item.id) ?? stableUuid("runtime-evolution-workbench/app-server-item", fallback);
}

export interface BackfillSummary {
  run: StoredRun;
  insertedEvents: number;
  omittedReasoningItems: number;
  mappingLossDeclared: true;
}

export interface ManagedRunRequest {
  cwd: string;
  prompt: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh";
  sandbox?: "read-only" | "workspace-write";
  timeoutMs?: number;
}

export interface ManagedRunResult {
  bundle: RunBundle;
  agentMessage: string;
}

export class CodexAppServerAdapter {
  constructor(
    readonly executable: string,
    readonly store: WorkbenchStore,
    readonly contentStore: ContentStore
  ) {}

  async listThreads(limit = 50): Promise<JsonObject[]> {
    const client = new CodexAppServerClient(this.executable);
    try {
      await client.start();
      const result = await client.request<JsonObject>("thread/list", { limit: Math.max(1, Math.min(limit, 100)) });
      return Array.isArray(result.data) ? result.data.filter(isObject) : [];
    } finally {
      await client.close();
    }
  }

  async backfillThread(threadId: string): Promise<BackfillSummary> {
    const client = new CodexAppServerClient(this.executable);
    try {
      await client.start();
      const response = await client.request<JsonObject>("thread/read", { threadId, includeTurns: true }, 60_000);
      if (!isObject(response.thread)) throw new AppServerError("thread/read did not return a thread");
      const thread = response.thread;
      const canonicalThreadId = stringValue(thread.id) ?? threadId;
      const sessionTreeId = stringValue(thread.sessionId);
      const existing = this.store.getRunByThreadId(canonicalThreadId)
        ?? this.store.getRunBySessionId(canonicalThreadId)
        ?? (sessionTreeId === null ? null : this.store.getRunBySessionId(sessionTreeId));
      const run = existing ?? this.store.ensureRun({
        sessionId: canonicalThreadId,
        threadId: canonicalThreadId,
        mode: "observed",
        status: "running",
        goal: stringValue(thread.preview) ?? "Stored Codex thread",
        cwd: stringValue(thread.cwd) ?? "unknown",
        agentVersion: stringValue(thread.cliVersion),
        startedAt: isoFromUnixSeconds(thread.createdAt),
        completeness: "partial"
      });
      this.store.updateRunThread(run.id, canonicalThreadId, stringValue(thread.cliVersion));
      if (run.goal === "Observed Codex session") this.store.updateRunGoal(run.id, stringValue(thread.preview) ?? "Stored Codex thread");

      let insertedEvents = 0;
      let omittedReasoningItems = 0;
      const turns = Array.isArray(thread.turns) ? thread.turns.filter(isObject) : [];
      for (const [turnIndex, turn] of turns.entries()) {
        const turnId = stringValue(turn.id) ?? `turn-${turnIndex}`;
        const turnStart = isoFromUnixSeconds(turn.startedAt, isoFromUnixSeconds(thread.createdAt));
        if (this.store.addEvent({
          id: stableUuid("runtime-evolution-workbench/backfill-turn-start", `${canonicalThreadId}\0${turnId}`),
          runId: run.id,
          turnId,
          timestamp: turnStart,
          receivedAt: new Date().toISOString(),
          type: "turn.started",
          source: "codex-app-server-stored",
          summary: "Stored turn started",
          data: { status: turn.status, items_view: turn.itemsView },
          contentRefs: [],
          redacted: false
        })) insertedEvents += 1;

        const items = Array.isArray(turn.items) ? turn.items.filter(isObject) : [];
        for (const [itemIndex, item] of items.entries()) {
          const type = stringValue(item.type) ?? "unknown";
          const timestamp = new Date(Date.parse(turnStart) + itemIndex).toISOString();
          const sourceId = itemId(item, `${canonicalThreadId}\0${turnId}\0${itemIndex}`);
          if (type === "reasoning") {
            omittedReasoningItems += 1;
            if (this.store.addEvent({
              id: stableUuid("runtime-evolution-workbench/backfill-item", `${canonicalThreadId}\0${turnId}\0${sourceId}\0reasoning-omitted`),
              runId: run.id,
              turnId,
              timestamp,
              receivedAt: new Date().toISOString(),
              type: "reasoning.omitted",
              source: "codex-app-server-stored",
              summary: "Reasoning content intentionally omitted",
              data: { item_id: sourceId, item_type: type, omitted: true },
              contentRefs: [],
              redacted: false
            })) insertedEvents += 1;
            continue;
          }
          const redacted = redactUnknown(item);
          const content = this.contentStore.putJson(redacted.value);
          if (this.store.addEvent({
            id: stableUuid("runtime-evolution-workbench/backfill-item", `${canonicalThreadId}\0${turnId}\0${sourceId}`),
            runId: run.id,
            turnId,
            timestamp,
            receivedAt: new Date().toISOString(),
            type: `item.${normalizeFragment(type)}`,
            source: "codex-app-server-stored",
            summary: itemSummary(item),
            data: redacted.value as JsonObject,
            contentRefs: [content.ref],
            redacted: redacted.redactedFieldCount > 0 || redacted.truncatedFieldCount > 0
          })) insertedEvents += 1;
        }

        const completedAt = numberValue(turn.completedAt);
        if (completedAt !== null) {
          if (this.store.addEvent({
            id: stableUuid("runtime-evolution-workbench/backfill-turn-complete", `${canonicalThreadId}\0${turnId}`),
            runId: run.id,
            turnId,
            timestamp: isoFromUnixSeconds(completedAt),
            receivedAt: new Date().toISOString(),
            type: "turn.completed",
            source: "codex-app-server-stored",
            summary: `Stored turn ${String(turn.status ?? "completed")}`,
            data: { status: turn.status, error: turn.error, duration_ms: turn.durationMs },
            contentRefs: [],
            redacted: false
          })) insertedEvents += 1;
        }
      }

      this.store.removeGaps(run.id, "source_unavailable", "codex-app-server");
      this.store.addGap({
        id: stableUuid("runtime-evolution-workbench/gap", `${run.id}\0app-server-stored-lossy`),
        runId: run.id,
        kind: "mapping_loss",
        summary: "Stored App Server turns are documented as potentially lossy; live command and tool lifecycle may be incomplete.",
        source: "codex-app-server-stored",
        startAt: null,
        endAt: null
      });
      if (omittedReasoningItems > 0) {
        this.store.addGap({
          id: stableUuid("runtime-evolution-workbench/gap", `${run.id}\0reasoning-excluded`),
          runId: run.id,
          kind: "excluded",
          summary: "Reasoning content is intentionally not retained; only its presence is recorded.",
          source: "codex-app-server-stored",
          startAt: null,
          endAt: null
        });
      }
      this.store.setCompleteness(run.id, "partial");

      const lastTurn = turns.at(-1);
      const lastCompletedAt = isObject(lastTurn) ? numberValue(lastTurn.completedAt) : null;
      const lastStatus = isObject(lastTurn) ? turnStatusToRunStatus(lastTurn.status) : "completed";
      const currentThreadStatus = threadStatusType(thread.status);
      if (lastCompletedAt !== null || currentThreadStatus === "idle" || currentThreadStatus === "notLoaded") {
        this.store.updateRunTerminal(run.id, lastStatus === "running" ? "completed" : lastStatus, lastCompletedAt === null ? isoFromUnixSeconds(thread.updatedAt) : isoFromUnixSeconds(lastCompletedAt));
      }
      const updated = this.store.getRun(run.id);
      if (updated === null) throw new Error("Backfilled run disappeared");
      return { run: updated, insertedEvents, omittedReasoningItems, mappingLossDeclared: true };
    } finally {
      await client.close();
    }
  }

  async runManaged(input: ManagedRunRequest): Promise<ManagedRunResult> {
    const client = new CodexAppServerClient(this.executable);
    let runId: string | null = null;
    let threadId: string | null = null;
    let turnId: string | null = null;
    let agentMessage = "";
    let completionResolve: ((params: JsonObject) => void) | null = null;
    const completion = new Promise<JsonObject>((resolve) => {
      completionResolve = resolve;
    });
    const unsubscribe = client.onNotification((method, params) => {
      const notificationThreadId = stringValue(params.threadId);
      if (threadId !== null && notificationThreadId !== null && notificationThreadId !== threadId) return;
      if (runId === null) return;
      const receivedAt = new Date().toISOString();
      const item = isObject(params.item) ? params.item : null;
      const notificationTurnId = stringValue(params.turnId) ?? turnId;
      const sourceKey = item === null
        ? `${method}\0${notificationTurnId ?? "none"}\0${JSON.stringify(params)}`
        : `${method}\0${notificationTurnId ?? "none"}\0${itemId(item, JSON.stringify(item))}`;
      let data: JsonObject = params;
      let summary = method;
      let redacted = false;
      let contentRefs: string[] = [];

      if (item !== null && stringValue(item.type) === "reasoning") {
        data = { item_id: itemId(item, sourceKey), item_type: "reasoning", omitted: true };
        summary = "Reasoning content intentionally omitted";
      } else {
        const result = redactUnknown(item ?? params);
        data = result.value as JsonObject;
        summary = item === null ? method.replaceAll("/", " ") : itemSummary(item);
        redacted = result.redactedFieldCount > 0 || result.truncatedFieldCount > 0;
        contentRefs = [this.contentStore.putJson(result.value).ref];
      }

      this.store.addEvent({
        id: stableUuid("runtime-evolution-workbench/live-notification", `${threadId ?? "pending"}\0${sourceKey}`),
        runId,
        turnId: notificationTurnId,
        timestamp: receivedAt,
        receivedAt,
        type: method.startsWith("item/") && item !== null
          ? `item.${normalizeFragment(stringValue(item.type) ?? "unknown")}.${method.endsWith("completed") ? "completed" : "started"}`
          : normalizeFragment(method),
        source: "codex-app-server-live",
        summary,
        data,
        contentRefs,
        redacted
      });

      if (item !== null && stringValue(item.type) === "agentMessage" && method === "item/completed") {
        agentMessage = stringValue(item.text) ?? agentMessage;
      }
      if (method === "turn/started") turnId = stringValue(isObject(params.turn) ? params.turn.id : null) ?? notificationTurnId;
      if (method === "turn/completed") completionResolve?.(params);
    });

    try {
      await client.start();
      const threadResponse = await client.request<JsonObject>("thread/start", {
        cwd: input.cwd,
        approvalPolicy: "never",
        sandbox: input.sandbox ?? "read-only",
        ephemeral: false,
        historyMode: "paginated",
        threadSource: "runtime-evolution-workbench"
      }, 30_000);
      if (!isObject(threadResponse.thread)) throw new AppServerError("thread/start did not return a thread");
      const thread = threadResponse.thread;
      threadId = stringValue(thread.id);
      if (threadId === null) throw new AppServerError("thread/start returned no thread id");
      const run = this.store.ensureRun({
        sessionId: threadId,
        threadId,
        mode: "managed",
        status: "running",
        goal: input.prompt,
        cwd: input.cwd,
        model: input.model ?? null,
        agentVersion: stringValue(thread.cliVersion),
        startedAt: isoFromUnixSeconds(thread.createdAt),
        completeness: "partial"
      });
      runId = run.id;
      this.store.addGap({
        id: stableUuid("runtime-evolution-workbench/gap", `${run.id}\0managed-reasoning-excluded`),
        runId: run.id,
        kind: "excluded",
        summary: "Hidden reasoning is neither requested nor stored by the workbench.",
        source: "codex-app-server-live",
        startAt: null,
        endAt: null
      });

      const turnResponse = await client.request<JsonObject>("turn/start", {
        threadId,
        input: [{ type: "text", text: input.prompt }],
        effort: input.effort ?? "low",
        ...(input.model === undefined ? {} : { model: input.model })
      }, 30_000);
      if (isObject(turnResponse.turn)) turnId = stringValue(turnResponse.turn.id) ?? turnId;

      const timeoutMs = Math.max(5_000, Math.min(input.timeoutMs ?? 120_000, 30 * 60_000));
      let completedParams: JsonObject;
      let completionTimeout: NodeJS.Timeout | null = null;
      try {
        completedParams = await Promise.race([
          completion,
          new Promise<never>((_, reject) => {
            completionTimeout = setTimeout(() => reject(new AppServerError("Managed Run timed out")), timeoutMs);
          })
        ]);
      } catch (error) {
        if (turnId !== null) {
          try {
            await client.request("turn/interrupt", { threadId, turnId }, 5_000);
          } catch {
            // The terminal timeout is already the stronger user-visible fact.
          }
        }
        this.store.updateRunTerminal(run.id, "agent_timeout");
        throw error;
      } finally {
        if (completionTimeout !== null) clearTimeout(completionTimeout);
      }

      const completedTurn = isObject(completedParams.turn) ? completedParams.turn : completedParams;
      const status = turnStatusToRunStatus(completedTurn.status);
      this.store.updateRunTerminal(run.id, status === "running" ? "infrastructure_error" : status, isoFromUnixSeconds(completedTurn.completedAt));
      const bundle = this.store.getRunBundle(run.id);
      if (bundle === null) throw new Error("Managed Run disappeared");
      return { bundle, agentMessage };
    } catch (error) {
      if (runId !== null) {
        const current = this.store.getRun(runId);
        if (current?.endedAt === null) this.store.updateRunTerminal(runId, "infrastructure_error");
      }
      throw error;
    } finally {
      unsubscribe();
      await client.close();
    }
  }
}

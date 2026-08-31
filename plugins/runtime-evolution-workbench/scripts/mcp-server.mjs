import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const tools = [
  {
    name: "rew_list_runs",
    description: "List locally retained Codex Runs. Observed Runs can have explicit capture gaps; do not treat the list as a complete transcript.",
    inputSchema: { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 100 } } }
  },
  {
    name: "rew_get_run",
    description: "Read one Run with structured events, corrections, outcome, and observation gaps. Report gaps before diagnosing a cause.",
    inputSchema: { type: "object", additionalProperties: false, required: ["run_id"], properties: { run_id: { type: "string", format: "uuid" } } }
  },
  {
    name: "rew_export_run",
    description: "Export one Run as a validated agent.run.v1 document for local retention or another compatible product.",
    inputSchema: { type: "object", additionalProperties: false, required: ["run_id"], properties: { run_id: { type: "string", format: "uuid" } } }
  },
  {
    name: "rew_add_correction",
    description: "Save an explicit user correction against a Run. This records evidence; it does not modify AGENTS.md or a Skill.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["run_id", "kind", "text"],
      properties: {
        run_id: { type: "string", format: "uuid" },
        kind: { type: "string", enum: ["result_label", "instruction", "replacement", "rollback", "other"] },
        text: { type: "string", minLength: 1 },
        target_event_ids: { type: "array", maxItems: 100, items: { type: "string", minLength: 1 } }
      }
    }
  },
  {
    name: "rew_create_issue",
    description: "Create an evidence-backed issue candidate from one or more Runs. A category is a hypothesis, not proof of root cause.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["title", "summary", "category", "evidence"],
      properties: {
        title: { type: "string", minLength: 1 },
        summary: { type: "string", minLength: 1 },
        category: { type: "string", enum: ["instruction", "skill", "tool", "environment", "permission", "validation", "model", "unknown"] },
        suggested_target: { type: ["string", "null"] },
        counter_evidence: { type: "string" },
        evidence: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["run_id", "note"],
            properties: {
              run_id: { type: "string", format: "uuid" },
              event_id: { type: ["string", "null"] },
              note: { type: "string", minLength: 1 }
            }
          }
        }
      }
    }
  },
  {
    name: "rew_list_proposals",
    description: "List bounded AGENTS.md or SKILL.md proposals and their review state. This does not approve or publish anything.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} }
  },
  {
    name: "rew_get_proposal",
    description: "Read one proposal, its exact diff, evidence Run references, and publish or rollback history.",
    inputSchema: { type: "object", additionalProperties: false, required: ["proposal_id"], properties: { proposal_id: { type: "string", format: "uuid" } } }
  },
  {
    name: "rew_create_proposal",
    description: "Create a reviewable proposal for exactly one AGENTS.md or SKILL.md from an issue, a failure Run, and a distinct protection Run. It never applies the file.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["issue_id", "workspace_root", "target_path", "target_kind", "candidate_content", "rationale", "original_run_id", "protection_run_id"],
      properties: {
        issue_id: { type: "string", format: "uuid" },
        workspace_root: { type: "string", minLength: 1 },
        target_path: { type: "string", minLength: 1 },
        target_kind: { type: "string", enum: ["agents", "skill"] },
        candidate_content: { type: "string", minLength: 1, maxLength: 65536 },
        rationale: { type: "string", minLength: 1 },
        original_run_id: { type: "string", format: "uuid" },
        protection_run_id: { type: "string", format: "uuid" }
      }
    }
  },
  {
    name: "rew_backfill_thread",
    description: "Ask the local workbench to map a stored Codex Thread into an observed Run. Stored App Server history remains explicitly marked as potentially lossy.",
    inputSchema: { type: "object", additionalProperties: false, required: ["thread_id"], properties: { thread_id: { type: "string", minLength: 1 } } }
  }
];

function dataRoot() {
  if (process.env.REW_DATA_DIR) return process.env.REW_DATA_DIR;
  if (process.env.LOCALAPPDATA) return join(process.env.LOCALAPPDATA, "RuntimeEvolutionWorkbench");
  return join(homedir(), ".runtime-evolution-workbench");
}

function token() {
  return readFileSync(join(dataRoot(), "session-token"), "utf8").trim();
}

async function api(path, options = {}) {
  const port = process.env.REW_PORT ?? "43119";
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token()}`,
      "content-type": "application/json",
      ...(options.headers ?? {})
    },
    signal: AbortSignal.timeout(120_000)
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function callTool(name, args) {
  if (name === "rew_list_runs") {
    await api("/api/ingest", { method: "POST" });
    return api(`/api/runs?limit=${encodeURIComponent(String(args.limit ?? 25))}`);
  }
  if (name === "rew_get_run") return api(`/api/runs/${encodeURIComponent(args.run_id)}`);
  if (name === "rew_export_run") return api(`/api/runs/${encodeURIComponent(args.run_id)}/export`);
  if (name === "rew_add_correction") {
    return api(`/api/runs/${encodeURIComponent(args.run_id)}/corrections`, {
      method: "POST",
      body: JSON.stringify({ kind: args.kind, text: args.text, targetEventIds: args.target_event_ids ?? [] })
    });
  }
  if (name === "rew_create_issue") {
    return api("/api/issues", {
      method: "POST",
      body: JSON.stringify({
        title: args.title,
        summary: args.summary,
        category: args.category,
        suggestedTarget: args.suggested_target,
        counterEvidence: args.counter_evidence,
        evidence: (args.evidence ?? []).map((entry) => ({ runId: entry.run_id, eventId: entry.event_id, note: entry.note }))
      })
    });
  }
  if (name === "rew_list_proposals") return api("/api/proposals");
  if (name === "rew_get_proposal") return api(`/api/proposals/${encodeURIComponent(args.proposal_id)}`);
  if (name === "rew_create_proposal") {
    return api("/api/proposals", {
      method: "POST",
      body: JSON.stringify({
        issueId: args.issue_id,
        workspaceRoot: args.workspace_root,
        targetPath: args.target_path,
        targetKind: args.target_kind,
        candidateContent: args.candidate_content,
        rationale: args.rationale,
        originalRunId: args.original_run_id,
        protectionRunId: args.protection_run_id
      })
    });
  }
  if (name === "rew_backfill_thread") {
    return api("/api/backfill", { method: "POST", body: JSON.stringify({ threadId: args.thread_id }) });
  }
  throw new Error(`Unknown tool: ${name}`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handle(message) {
  if (!message || typeof message !== "object" || typeof message.method !== "string") return;
  if (!("id" in message)) return;
  try {
    if (message.method === "initialize") {
      const requested = message.params?.protocolVersion;
      const supported = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"];
      send({ jsonrpc: "2.0", id: message.id, result: {
        protocolVersion: supported.includes(requested) ? requested : "2025-11-25",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "runtime-evolution-workbench", version: "0.2.0" }
      } });
      return;
    }
    if (message.method === "ping") {
      send({ jsonrpc: "2.0", id: message.id, result: {} });
      return;
    }
    if (message.method === "tools/list") {
      send({ jsonrpc: "2.0", id: message.id, result: { tools } });
      return;
    }
    if (message.method === "tools/call") {
      const result = await callTool(message.params?.name, message.params?.arguments ?? {});
      send({ jsonrpc: "2.0", id: message.id, result: {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
        isError: false
      } });
      return;
    }
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
  } catch (error) {
    send({ jsonrpc: "2.0", id: message.id, result: {
      content: [{ type: "text", text: `Runtime Evolution Workbench unavailable: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true
    } });
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).replace(/\r$/, "");
    buffer = buffer.slice(index + 1);
    if (line.trim().length === 0) continue;
    try {
      void handle(JSON.parse(line));
    } catch {
      // Invalid transport lines are ignored; stdout remains protocol-only.
    }
  }
});

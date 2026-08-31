import { existsSync } from "node:fs";

import cookie from "@fastify/cookie";
import staticPlugin from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

import { tokenMatches } from "./auth.js";
import { CodexAppServerAdapter } from "./app-server/adapter.js";
import { ComparisonService } from "./comparison-service.js";
import type { WorkbenchConfig } from "./config.js";
import { EvolutionService } from "./evolution-service.js";
import { HookIngestor } from "./hook-ingestor.js";
import { AgentRunExporter } from "./protocol-export.js";
import { ProtocolImportError, ProtocolImportService } from "./protocol-import.js";
import { redactUnknown } from "./redaction.js";
import { WorkbenchStore } from "./store.js";

export interface AppDependencies {
  config: WorkbenchConfig;
  sessionToken: string;
  store: WorkbenchStore;
  ingestor: HookIngestor;
  adapter: CodexAppServerAdapter;
  exporter: AgentRunExporter;
  protocolImports: ProtocolImportService;
  evolution: EvolutionService;
  comparisons: ComparisonService;
}

const outcomeBody = z.object({
  status: z.enum(["success", "partial", "failure", "unknown"]),
  summary: z.string().max(10_000)
});

const correctionBody = z.object({
  kind: z.enum(["result_label", "instruction", "replacement", "rollback", "other"]),
  text: z.string().min(1).max(50_000),
  targetEventIds: z.array(z.string().min(1)).max(100).default([])
});

const issueBody = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(10_000),
  category: z.enum(["instruction", "skill", "tool", "environment", "permission", "validation", "model", "unknown"]),
  suggestedTarget: z.string().max(2_000).nullable().optional(),
  counterEvidence: z.string().max(10_000).optional(),
  evidence: z.array(z.object({
    runId: z.uuid(),
    eventId: z.string().min(1).nullable().optional(),
    note: z.string().min(1).max(5_000)
  })).min(1).max(100)
});

const managedRunBody = z.object({
  cwd: z.string().min(1),
  prompt: z.string().min(1).max(100_000),
  model: z.string().min(1).optional(),
  effort: z.enum(["low", "medium", "high", "xhigh"]).optional(),
  sandbox: z.enum(["read-only", "workspace-write"]).optional(),
  timeoutMs: z.number().int().min(5_000).max(30 * 60_000).optional()
});

const proposalBody = z.object({
  issueId: z.uuid(),
  workspaceRoot: z.string().min(1),
  targetPath: z.string().min(1),
  targetKind: z.enum(["agents", "skill"]),
  candidateContent: z.string().min(1).max(64 * 1024),
  rationale: z.string().min(1).max(20_000),
  originalRunId: z.uuid(),
  protectionRunId: z.uuid()
});

const comparisonBody = z.object({
  proposalId: z.uuid(),
  cases: z.array(z.object({
    kind: z.enum(["failure", "protection"]),
    name: z.string().min(1).max(200),
    prompt: z.string().min(1).max(100_000),
    verifierCommand: z.string().min(1).max(2_000),
    verifierArgs: z.array(z.string().max(10_000)).max(100).default([]),
    verifierTimeoutMs: z.number().int().min(1_000).max(15 * 60_000).optional()
  })).length(2)
});

const protocolImportBody = z.object({
  document: z.record(z.string(), z.unknown())
});

function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1];
}

export async function createWorkbenchApp(deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  await app.register(cookie);

  app.get("/health", async () => ({ ok: true, product: "runtime-evolution-workbench", version: "0.2.0" }));

  app.get<{ Params: { token: string } }>("/session/:token", async (request, reply) => {
    if (!tokenMatches(deps.sessionToken, request.params.token)) return reply.code(404).send({ error: "not_found" });
    reply.setCookie("rew_session", deps.sessionToken, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: false,
      maxAge: 12 * 60 * 60
    });
    return reply.redirect("/");
  });

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    const candidate = bearerToken(request.headers.authorization) ?? request.cookies.rew_session;
    if (!tokenMatches(deps.sessionToken, candidate)) return reply.code(401).send({ error: "authentication_required" });
  });

  app.get("/api/meta", async () => ({
    product: "Runtime Evolution Workbench",
    version: "0.2.0",
    captureBoundary: "Observed Runs are best effort; Managed Runs retain live structured events and explicit exclusions.",
    dataDir: deps.config.dataDir
  }));

  app.post("/api/ingest", async () => ({ results: deps.ingestor.processPending() }));

  app.get("/api/protocol/imports", async () => ({
    documents: deps.store.listProtocolDocuments().map(({ document: _document, ...metadata }) => metadata)
  }));

  app.get<{ Params: { id: string } }>("/api/protocol/imports/:id", async (request, reply) => {
    const document = deps.store.getProtocolDocument(request.params.id);
    return document === null
      ? reply.code(404).send({ error: "protocol_document_not_found" })
      : document;
  });

  app.post("/api/protocol/imports", async (request, reply) => {
    const parsed = protocolImportBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: z.prettifyError(parsed.error) });
    try {
      return reply.code(201).send(deps.protocolImports.importDocument(parsed.data.document));
    } catch (error) {
      if (error instanceof ProtocolImportError) return reply.code(422).send({ error: error.message });
      throw error;
    }
  });

  app.get<{ Querystring: { limit?: string } }>("/api/runs", async (request) => {
    const parsed = Number.parseInt(request.query.limit ?? "100", 10);
    return { runs: deps.store.listRuns(Number.isFinite(parsed) ? parsed : 100) };
  });

  app.get<{ Params: { id: string } }>("/api/runs/:id", async (request, reply) => {
    const bundle = deps.store.getRunBundle(request.params.id);
    return bundle === null ? reply.code(404).send({ error: "run_not_found" }) : bundle;
  });

  app.get<{ Params: { id: string } }>("/api/runs/:id/export", async (request, reply) => {
    try {
      reply.header("content-type", "application/json; charset=utf-8");
      reply.header("content-disposition", `attachment; filename=agent-run-${request.params.id}.json`);
      return deps.exporter.export(request.params.id);
    } catch (error) {
      return reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Params: { id: string } }>("/api/runs/:id/outcome", async (request, reply) => {
    const parsed = outcomeBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: z.prettifyError(parsed.error) });
    if (deps.store.getRun(request.params.id) === null) return reply.code(404).send({ error: "run_not_found" });
    deps.store.updateOutcome(request.params.id, parsed.data.status, parsed.data.summary);
    return deps.store.getRunBundle(request.params.id);
  });

  app.post<{ Params: { id: string } }>("/api/runs/:id/corrections", async (request, reply) => {
    const parsed = correctionBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: z.prettifyError(parsed.error) });
    if (deps.store.getRun(request.params.id) === null) return reply.code(404).send({ error: "run_not_found" });
    const redacted = redactUnknown(parsed.data.text);
    const correction = deps.store.addCorrection({
      runId: request.params.id,
      kind: parsed.data.kind,
      text: redacted.value,
      targetEventIds: parsed.data.targetEventIds,
      redacted: redacted.redactedFieldCount > 0 || redacted.truncatedFieldCount > 0
    });
    return reply.code(201).send(correction);
  });

  app.get("/api/issues", async () => ({ issues: deps.store.listIssues() }));

  app.get<{ Params: { id: string } }>("/api/issues/:id", async (request, reply) => {
    const issue = deps.store.getIssue(request.params.id);
    return issue === null
      ? reply.code(404).send({ error: "issue_not_found" })
      : { issue, evidence: deps.store.getIssueEvidence(issue.id) };
  });

  app.post("/api/issues", async (request, reply) => {
    const parsed = issueBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: z.prettifyError(parsed.error) });
    try {
      return reply.code(201).send(deps.store.createIssue({
        title: parsed.data.title,
        summary: parsed.data.summary,
        category: parsed.data.category,
        evidence: parsed.data.evidence.map((evidence) => ({
          runId: evidence.runId,
          note: evidence.note,
          ...(evidence.eventId === undefined ? {} : { eventId: evidence.eventId })
        })),
        ...(parsed.data.suggestedTarget === undefined ? {} : { suggestedTarget: parsed.data.suggestedTarget }),
        ...(parsed.data.counterEvidence === undefined ? {} : { counterEvidence: parsed.data.counterEvidence })
      }));
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/proposals", async () => ({ proposals: deps.store.listProposals() }));

  app.get<{ Params: { id: string } }>("/api/proposals/:id", async (request, reply) => {
    const detail = deps.evolution.getProposalDetail(request.params.id);
    return detail === null ? reply.code(404).send({ error: "proposal_not_found" }) : detail;
  });

  app.post("/api/proposals", async (request, reply) => {
    const parsed = proposalBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: z.prettifyError(parsed.error) });
    try {
      return reply.code(201).send(deps.evolution.createProposal(parsed.data));
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  for (const action of ["approve", "reject", "publish", "rollback"] as const) {
    app.post<{ Params: { id: string } }>(`/api/proposals/:id/${action}`, async (request, reply) => {
      try {
        const result = deps.evolution[action](request.params.id);
        if ("status" in result && result.status === "conflict") return reply.code(409).send(result);
        return result;
      } catch (error) {
        return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
      }
    });
  }

  app.get<{ Querystring: { proposalId?: string } }>("/api/comparisons", async (request) => ({
    comparisons: deps.store.listComparisons(request.query.proposalId)
  }));

  app.get<{ Params: { id: string } }>("/api/comparisons/:id", async (request, reply) => {
    const detail = deps.comparisons.detail(request.params.id);
    return detail === null ? reply.code(404).send({ error: "comparison_not_found" }) : detail;
  });

  app.post("/api/comparisons", async (request, reply) => {
    const parsed = comparisonBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: z.prettifyError(parsed.error) });
    try {
      return reply.code(201).send(await deps.comparisons.create(
        parsed.data.proposalId,
        parsed.data.cases.map((comparisonCase) => ({
          kind: comparisonCase.kind,
          name: comparisonCase.name,
          prompt: comparisonCase.prompt,
          verifierCommand: comparisonCase.verifierCommand,
          verifierArgs: comparisonCase.verifierArgs,
          ...(comparisonCase.verifierTimeoutMs === undefined ? {} : { verifierTimeoutMs: comparisonCase.verifierTimeoutMs })
        }))
      ));
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post<{ Params: { id: string } }>("/api/comparisons/:id/run", async (request, reply) => {
    try {
      return await deps.comparisons.run(request.params.id);
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Querystring: { limit?: string } }>("/api/codex/threads", async (request, reply) => {
    try {
      const limit = Number.parseInt(request.query.limit ?? "25", 10);
      return { threads: await deps.adapter.listThreads(Number.isFinite(limit) ? limit : 25) };
    } catch (error) {
      return reply.code(503).send({ error: "app_server_unavailable", details: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/backfill", async (request, reply) => {
    const parsed = z.object({ threadId: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: z.prettifyError(parsed.error) });
    try {
      return await deps.adapter.backfillThread(parsed.data.threadId);
    } catch (error) {
      return reply.code(503).send({ error: "backfill_failed", details: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/managed-runs", async (request, reply) => {
    const parsed = managedRunBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: z.prettifyError(parsed.error) });
    try {
      return reply.code(201).send(await deps.adapter.runManaged({
        cwd: parsed.data.cwd,
        prompt: parsed.data.prompt,
        ...(parsed.data.model === undefined ? {} : { model: parsed.data.model }),
        ...(parsed.data.effort === undefined ? {} : { effort: parsed.data.effort }),
        ...(parsed.data.sandbox === undefined ? {} : { sandbox: parsed.data.sandbox }),
        ...(parsed.data.timeoutMs === undefined ? {} : { timeoutMs: parsed.data.timeoutMs })
      }));
    } catch (error) {
      return reply.code(503).send({ error: "managed_run_failed", details: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get<{ Params: { ref: string } }>("/api/content/:ref", async (request, reply) => {
    try {
      const content = deps.ingestor.contentStore.read(request.params.ref);
      return reply.type("application/octet-stream").send(content);
    } catch {
      return reply.code(404).send({ error: "content_not_found" });
    }
  });

  if (existsSync(deps.config.webRoot)) {
    await app.register(staticPlugin, { root: deps.config.webRoot, wildcard: false });
    app.get("/*", async (_request, reply) => reply.sendFile("index.html"));
  } else {
    app.get("/", async (_request, reply) => reply.type("text/plain").send("Runtime Evolution Workbench UI has not been built yet.\n"));
  }

  return app;
}

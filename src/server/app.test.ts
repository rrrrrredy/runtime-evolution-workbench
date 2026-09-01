import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CodexAppServerAdapter } from "./app-server/adapter.js";
import { createWorkbenchApp } from "./app.js";
import { ComparisonService } from "./comparison-service.js";
import type { WorkbenchConfig } from "./config.js";
import { ContentStore } from "./content-store.js";
import { EvolutionService } from "./evolution-service.js";
import { EvolutionKnowledgeService } from "./evolution-knowledge.js";
import { HookIngestor } from "./hook-ingestor.js";
import { AgentRunExporter } from "./protocol-export.js";
import { ProtocolImportService } from "./protocol-import.js";
import { WorkbenchStore } from "./store.js";

describe("local HTTP boundary", () => {
  it("keeps health public but protects all product data with the random session token", async () => {
    const scratchRoot = process.env.REW_TEST_TMP ?? tmpdir();
    mkdirSync(scratchRoot, { recursive: true });
    const root = mkdtempSync(join(scratchRoot, "rew-api-"));
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
      codexExecutable: "missing-codex-for-api-test",
      webRoot: join(root, "missing-web")
    };
    for (const directory of [config.contentDir, config.spoolPendingDir, config.spoolArchiveDir, config.spoolRejectedDir]) mkdirSync(directory, { recursive: true });
    const store = new WorkbenchStore(config.databasePath);
    const contentStore = new ContentStore(config.contentDir);
    const ingestor = new HookIngestor(config, store, contentStore);
    const adapter = new CodexAppServerAdapter(config.codexExecutable, store, contentStore);
    const exporter = new AgentRunExporter(store);
    const protocolImports = new ProtocolImportService(store);
    const evolution = new EvolutionService(store, contentStore);
    const knowledge = new EvolutionKnowledgeService(store);
    const comparisons = new ComparisonService(config, store, contentStore, adapter);
    const sessionToken = "0123456789abcdef0123456789abcdef";
    const app = await createWorkbenchApp({ config, sessionToken, store, ingestor, adapter, exporter, protocolImports, evolution, knowledge, comparisons });
    try {
      expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/api/runs" })).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url: "/api/patterns" })).statusCode).toBe(401);
      expect((await app.inject({ method: "POST", url: "/api/protocol/imports", payload: { document: {} } })).statusCode).toBe(401);
      expect((await app.inject({ method: "GET", url: "/api/runs", headers: { authorization: `Bearer ${sessionToken}` } })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/api/patterns", headers: { authorization: `Bearer ${sessionToken}` } })).statusCode).toBe(200);
      expect((await app.inject({
        method: "POST",
        url: "/api/protocol/imports",
        headers: { authorization: `Bearer ${sessionToken}` },
        payload: { document: {} }
      })).statusCode).toBe(422);
      const session = await app.inject({ method: "GET", url: `/session/${sessionToken}` });
      expect(session.statusCode).toBe(302);
      expect(session.headers["set-cookie"]).toContain("HttpOnly");
      expect(session.headers["set-cookie"]).toContain("SameSite=Strict");
    } finally {
      await app.close();
      store.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

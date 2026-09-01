import { loadOrCreateSessionToken } from "./auth.js";
import { CodexAppServerAdapter } from "./app-server/adapter.js";
import { createWorkbenchApp } from "./app.js";
import { ComparisonService } from "./comparison-service.js";
import { loadConfig } from "./config.js";
import { ContentStore } from "./content-store.js";
import { EvolutionService } from "./evolution-service.js";
import { EvolutionKnowledgeService } from "./evolution-knowledge.js";
import { HookIngestor } from "./hook-ingestor.js";
import { AgentRunExporter } from "./protocol-export.js";
import { ProtocolImportService } from "./protocol-import.js";
import { WorkbenchStore } from "./store.js";

const config = loadConfig();
const sessionToken = loadOrCreateSessionToken(config.tokenPath);
const store = new WorkbenchStore(config.databasePath);
const contentStore = new ContentStore(config.contentDir);
const ingestor = new HookIngestor(config, store, contentStore);
const adapter = new CodexAppServerAdapter(config.codexExecutable, store, contentStore);
const exporter = new AgentRunExporter(store);
const protocolImports = new ProtocolImportService(store);
const evolution = new EvolutionService(store, contentStore);
const knowledge = new EvolutionKnowledgeService(store);
const comparisons = new ComparisonService(config, store, contentStore, adapter);
const recovered = store.recoverInterruptedState();
const cleanup = await comparisons.cleanupInterrupted(recovered.comparisonIds);
const app = await createWorkbenchApp({ config, sessionToken, store, ingestor, adapter, exporter, protocolImports, evolution, knowledge, comparisons });

ingestor.start();
await app.listen({ host: config.host, port: config.port });
process.stdout.write(`Runtime Evolution Workbench: http://${config.host}:${config.port}/session/${sessionToken}\n`);
process.stdout.write(`Local data: ${config.dataDir}\n`);
if (recovered.runIds.length > 0 || recovered.comparisonIds.length > 0) {
  process.stdout.write(`Recovered interrupted state: ${recovered.runIds.length} Run(s), ${recovered.comparisonIds.length} comparison(s).\n`);
}
if (cleanup.failures.length > 0) {
  process.stderr.write(`Interrupted worktree cleanup warnings:\n${cleanup.failures.join("\n")}\n`);
}

async function shutdown(): Promise<void> {
  ingestor.stop();
  await app.close();
  store.close();
}

process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

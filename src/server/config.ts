import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface WorkbenchConfig {
  host: "127.0.0.1";
  port: number;
  dataDir: string;
  databasePath: string;
  contentDir: string;
  spoolPendingDir: string;
  spoolArchiveDir: string;
  spoolRejectedDir: string;
  tokenPath: string;
  codexExecutable: string;
  webRoot: string;
}

const dataMarkerName = ".runtime-evolution-workbench-data.json";

export function ensureWorkbenchDataRoot(requestedDataDir: string): void {
  const dataDir = resolve(requestedDataDir);
  if (existsSync(dataDir)) {
    const dataRoot = lstatSync(dataDir);
    if (!dataRoot.isDirectory() || dataRoot.isSymbolicLink()) {
      throw new Error(`Runtime Evolution Workbench data root must be a real directory: ${dataDir}`);
    }
    const markerPath = join(dataDir, dataMarkerName);
    if (existsSync(markerPath)) {
      if (lstatSync(markerPath).isSymbolicLink()) throw new Error(`Data-root marker cannot be a symbolic link: ${markerPath}`);
      let marker: unknown;
      try {
        marker = JSON.parse(readFileSync(markerPath, "utf8"));
      } catch {
        throw new Error(`Runtime Evolution Workbench data marker is invalid: ${markerPath}`);
      }
      if (
        marker === null ||
        typeof marker !== "object" ||
        (marker as Record<string, unknown>).schema_version !== "product.data-root.v1" ||
        (marker as Record<string, unknown>).product !== "runtime-evolution-workbench"
      ) {
        throw new Error(`Runtime Evolution Workbench data marker names another product: ${markerPath}`);
      }
      return;
    }
    throw new Error(`Data directory already exists but has no Runtime Evolution Workbench ownership marker: ${dataDir}`);
  } else {
    mkdirSync(dataDir, { recursive: true });
  }
  writeFileSync(
    join(dataDir, dataMarkerName),
    `${JSON.stringify({
      schema_version: "product.data-root.v1",
      product: "runtime-evolution-workbench",
      created_at: new Date().toISOString()
    }, null, 2)}\n`,
    { encoding: "utf8", flag: "wx" }
  );
}

function defaultDataDir(): string {
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData !== undefined && localAppData.length > 0) {
    return join(localAppData, "RuntimeEvolutionWorkbench");
  }
  return join(homedir(), ".runtime-evolution-workbench");
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return 43119;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) {
    throw new Error("REW_PORT must be an integer between 1024 and 65535");
  }
  return parsed;
}

export function loadConfig(): WorkbenchConfig {
  const requestedHost = process.env.REW_HOST ?? "127.0.0.1";
  if (requestedHost !== "127.0.0.1") {
    throw new Error("Runtime Evolution Workbench only binds to 127.0.0.1");
  }

  const dataDir = resolve(process.env.REW_DATA_DIR ?? defaultDataDir());
  ensureWorkbenchDataRoot(dataDir);
  const config: WorkbenchConfig = {
    host: "127.0.0.1",
    port: parsePort(process.env.REW_PORT),
    dataDir,
    databasePath: join(dataDir, "workbench.sqlite3"),
    contentDir: join(dataDir, "content"),
    spoolPendingDir: join(dataDir, "spool", "pending"),
    spoolArchiveDir: join(dataDir, "spool", "archive"),
    spoolRejectedDir: join(dataDir, "spool", "rejected"),
    tokenPath: join(dataDir, "session-token"),
    codexExecutable: process.env.CODEX_EXECUTABLE ?? "codex",
    webRoot: resolve(process.cwd(), "dist", "web")
  };

  for (const directory of [config.dataDir, config.contentDir, config.spoolPendingDir, config.spoolArchiveDir, config.spoolRejectedDir]) {
    mkdirSync(directory, { recursive: true });
  }

  return config;
}

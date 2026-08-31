import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import { redactUnknown } from "../redaction.js";

type JsonObject = Record<string, unknown>;
type NotificationHandler = (method: string, params: JsonObject) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function describeAppServerFailure(value: unknown): string {
  const redacted = redactUnknown(value, { maxStringLength: 2_000 }).value;
  if (isObject(redacted) && typeof redacted.message === "string" && redacted.message.length > 0) {
    return redacted.message;
  }
  return "unknown server error";
}

export class AppServerError extends Error {
  constructor(message: string, readonly details?: unknown) {
    super(message);
    this.name = "AppServerError";
  }
}

export class CodexAppServerClient {
  #child: ChildProcessWithoutNullStreams | null = null;
  #nextId = 1;
  #pending = new Map<number, PendingRequest>();
  #handlers = new Set<NotificationHandler>();
  #stderr = "";

  constructor(readonly executable: string) {}

  async start(): Promise<void> {
    if (this.#child !== null) return;
    const child = spawn(this.executable, ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    this.#child = child;
    child.stderr.on("data", (chunk: Buffer) => {
      this.#stderr += chunk.toString("utf8");
      if (this.#stderr.length > 16_384) this.#stderr = this.#stderr.slice(-16_384);
    });
    child.on("error", (error) => this.#rejectAll(new AppServerError(`Could not start Codex App Server: ${error.message}`)));
    child.on("exit", (code, signal) => {
      if (this.#child === child) this.#child = null;
      this.#rejectAll(new AppServerError(`Codex App Server exited (code ${String(code)}, signal ${String(signal)}).`, this.#stderr));
    });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.#handleLine(line));

    await this.request("initialize", {
      clientInfo: {
        name: "runtime_evolution_workbench",
        title: "Runtime Evolution Workbench",
        version: "0.2.0"
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        optOutNotificationMethods: [
          "item/agentMessage/delta",
          "item/commandExecution/outputDelta",
          "item/fileChange/outputDelta",
          "item/reasoning/summaryTextDelta",
          "item/reasoning/summaryPartAdded",
          "item/reasoning/textDelta"
        ],
        extensions: {}
      }
    });
    this.notify("initialized");
  }

  onNotification(handler: NotificationHandler): () => void {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  request<T = unknown>(method: string, params: JsonObject = {}, timeoutMs = 30_000): Promise<T> {
    const id = this.#nextId++;
    const child = this.#child;
    if (child === null) return Promise.reject(new AppServerError("Codex App Server is not running"));
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new AppServerError(`App Server request timed out: ${method}`));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout
      });
      child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    });
  }

  notify(method: string, params?: JsonObject): void {
    const child = this.#child;
    if (child === null) throw new AppServerError("Codex App Server is not running");
    child.stdin.write(`${JSON.stringify(params === undefined ? { method } : { method, params })}\n`);
  }

  async close(): Promise<void> {
    const child = this.#child;
    if (child === null) return;
    this.#child = null;
    this.#rejectAll(new AppServerError("Codex App Server connection closed"));
    child.kill();
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 2_000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  #handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!isObject(message)) return;

    if (typeof message.method === "string" && "id" in message) {
      this.#respondUnsupportedServerRequest(message.id, message.method);
      return;
    }

    if (typeof message.id === "number") {
      const pending = this.#pending.get(message.id);
      if (pending === undefined) return;
      clearTimeout(pending.timeout);
      this.#pending.delete(message.id);
      if ("error" in message) {
        pending.reject(new AppServerError(`App Server request failed: ${describeAppServerFailure(message.error)}`, message.error));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message.method === "string") {
      const params = isObject(message.params) ? message.params : {};
      for (const handler of this.#handlers) handler(message.method, params);
    }
  }

  #respondUnsupportedServerRequest(id: unknown, method: string): void {
    const child = this.#child;
    if (child === null) return;
    child.stdin.write(`${JSON.stringify({
      id,
      error: {
        code: -32001,
        message: `Runtime Evolution Workbench does not auto-approve interactive request: ${method}`
      }
    })}\n`);
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

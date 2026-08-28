import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const codexExecutable = process.env.CODEX_EXECUTABLE ?? "codex";

const child = spawn(codexExecutable, ["app-server", "--listen", "stdio://"], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

const timeout = setTimeout(() => {
  process.stderr.write("Probe timed out waiting for App Server.\n");
  child.kill();
  process.exitCode = 1;
}, 15_000);

let firstThreadId;
let finished = false;

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function finish(summary) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  child.kill();
}

child.on("error", (error) => {
  clearTimeout(timeout);
  process.stderr.write(`Could not start App Server: ${error.message}\n`);
  process.exitCode = 1;
});

let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
  if (stderr.length > 4000) stderr = stderr.slice(-4000);
});

const lines = createInterface({ input: child.stdout });
lines.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  if (message.id === 1 && message.result) {
    send({ method: "initialized" });
    send({ method: "thread/list", id: 2, params: { limit: 5 } });
    return;
  }

  if (message.id === 2 && message.result) {
    const threads = message.result.data ?? [];
    firstThreadId = threads[0]?.id;
    if (!firstThreadId) {
      finish({
        initialized: true,
        listedThreads: 0,
        readableThread: false,
        note: "No stored thread was returned.",
      });
      return;
    }
    send({ method: "thread/read", id: 3, params: { threadId: firstThreadId, includeTurns: true } });
    return;
  }

  if (message.id === 3 && message.result) {
    const thread = message.result.thread;
    const turns = thread?.turns ?? [];
    const itemTypeCounts = {};
    for (const turn of turns) {
      for (const item of turn.items ?? []) {
        const type = item.type ?? "unknown";
        itemTypeCounts[type] = (itemTypeCounts[type] ?? 0) + 1;
      }
    }
    finish({
      initialized: true,
      listedThreads: "at_least_one",
      readableThread: true,
      source: typeof thread?.source === "string" ? thread.source : "structured",
      cliVersion: thread?.cliVersion ?? null,
      turnCount: turns.length,
      itemTypeCounts,
      completenessBoundary:
        "thread/read returns persisted items only; live command and tool lifecycle still requires hooks or a managed App Server connection",
    });
    return;
  }

  if (message.error) {
    clearTimeout(timeout);
    process.stderr.write(`App Server error: ${JSON.stringify(message.error)}\n${stderr}`);
    child.kill();
    process.exitCode = 1;
  }
});

child.on("exit", (code) => {
  if (!finished && process.exitCode !== 1) {
    clearTimeout(timeout);
    process.stderr.write(`App Server exited before the probe completed (code ${code}).\n${stderr}`);
    process.exitCode = 1;
  }
});

send({
  method: "initialize",
  id: 1,
  params: {
    clientInfo: {
      name: "runtime-evolution-workbench-probe",
      title: "Runtime Evolution Workbench Probe",
      version: "0.1.0",
    },
    capabilities: {
      experimentalApi: true,
      requestAttestation: false,
      optOutNotificationMethods: [],
      extensions: {},
    },
  },
});

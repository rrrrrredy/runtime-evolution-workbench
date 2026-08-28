import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const codexExecutable = process.env.CODEX_EXECUTABLE ?? "codex";

const child = spawn(codexExecutable, ["app-server", "--listen", "stdio://"], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});

let threadId;
let agentMessage = "";
const itemTypeCounts = {};
let finished = false;
let stderr = "";

const timeout = setTimeout(() => {
  if (finished) return;
  finished = true;
  process.stderr.write("Managed probe timed out.\n");
  child.kill();
  process.exitCode = 1;
}, 45_000);

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function finish(turn) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  process.stdout.write(
    `${JSON.stringify(
      {
        initialized: true,
        threadStarted: Boolean(threadId),
        turnStatus: turn?.status ?? "unknown",
        itemTypeCounts,
        agentResponseMatched: agentMessage.trim() === "MANAGED_PROBE_OK",
        hiddenReasoningStored: false,
      },
      null,
      2,
    )}\n`,
  );
  child.kill();
}

child.on("error", (error) => {
  clearTimeout(timeout);
  process.stderr.write(`Could not start App Server: ${error.message}\n`);
  process.exitCode = 1;
});

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

  if (message.id === 0 && message.result) {
    send({ method: "initialized" });
    send({
      method: "thread/start",
      id: 1,
      params: {
        cwd: process.cwd(),
        approvalPolicy: "never",
        sandbox: "read-only",
        ephemeral: true,
        threadSource: "runtime-evolution-workbench-probe",
      },
    });
    return;
  }

  if (message.id === 1 && message.result?.thread?.id) {
    threadId = message.result.thread.id;
    send({
      method: "turn/start",
      id: 2,
      params: {
        threadId,
        input: [
          {
            type: "text",
            text: "Reply with exactly MANAGED_PROBE_OK. Do not call tools and do not add punctuation.",
          },
        ],
        effort: "low",
      },
    });
    return;
  }

  if (message.method === "item/completed") {
    const item = message.params?.item;
    const type = item?.type ?? "unknown";
    itemTypeCounts[type] = (itemTypeCounts[type] ?? 0) + 1;
    if (type === "agentMessage") agentMessage = item.text ?? "";
    return;
  }

  if (message.method === "turn/completed") {
    finish(message.params?.turn);
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
    process.stderr.write(`App Server exited early (code ${code}).\n${stderr}`);
    process.exitCode = 1;
  }
});

send({
  method: "initialize",
  id: 0,
  params: {
    clientInfo: {
      name: "runtime_evolution_workbench_probe",
      title: "Runtime Evolution Workbench Probe",
      version: "0.1.0",
    },
    capabilities: {
      experimentalApi: true,
      requestAttestation: false,
      optOutNotificationMethods: [
        "item/agentMessage/delta",
        "item/reasoning/summaryTextDelta",
        "item/reasoning/summaryPartAdded",
        "item/reasoning/textDelta"
      ],
      extensions: {},
    },
  },
});

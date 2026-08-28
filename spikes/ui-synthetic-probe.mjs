import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { WorkbenchStore } from "../dist/server/store.js";
import { ensureWorkbenchDataRoot } from "../dist/server/config.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratchDir = mkdtempSync(join(tmpdir(), "rew-synthetic-ui-"));
const dataDir = join(scratchDir, "data");
ensureWorkbenchDataRoot(dataDir);
const outputDir = resolve(process.env.REW_UI_OUTPUT_DIR ?? join(root, "docs", "images"));
const port = Number.parseInt(process.env.REW_SYNTHETIC_PORT ?? "43139", 10);
const require = createRequire(import.meta.url);
const playwrightModule = process.env.REW_PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = require(playwrightModule);
const browserChannel = process.env.REW_BROWSER_CHANNEL;
const protocolFixture = process.env.REW_PROTOCOL_FIXTURE;
mkdirSync(outputDir, { recursive: true });

function addSyntheticRun(store, input) {
  const run = store.ensureRun({
    sessionId: input.sessionId,
    mode: input.mode,
    status: "completed",
    goal: input.goal,
    cwd: "C:\\demo\\weather-widget",
    model: "demo-model",
    agentVersion: "0.150.0-demo",
    startedAt: input.startedAt,
    completeness: input.completeness
  });
  const eventTimes = [0, 15, 44, 78].map((seconds) => new Date(Date.parse(input.startedAt) + seconds * 1_000).toISOString());
  const events = [
    ["user_prompt", "hook", "User requested a fix in the synthetic weather widget", { prompt: "Fix stale demo cache entries and run the demo tests." }],
    ["file_read", "app-server", "Read the synthetic cache implementation", { path: "src/cache.ts" }],
    ["file_change", "app-server", "Updated the synthetic cache invalidation rule", { path: "src/cache.ts", linesChanged: 7 }],
    ["command", "app-server", "Ran the objective demo test", { command: "npm test -- cache", exitCode: input.outcome === "failure" ? 1 : 0 }]
  ];
  events.forEach(([type, source, summary, data], sequence) => store.addEvent({
    id: randomUUID(),
    runId: run.id,
    turnId: "turn-demo",
    sequence,
    timestamp: eventTimes[sequence],
    receivedAt: eventTimes[sequence],
    type,
    source,
    summary,
    data,
    redacted: false
  }));
  store.updateRunTerminal(run.id, "completed", new Date(Date.parse(input.startedAt) + 90_000).toISOString());
  store.updateOutcome(run.id, input.outcome, input.outcome === "failure"
    ? "Synthetic cache regression remained after the first attempt."
    : "Synthetic verifier passed.");
  if (input.completeness === "partial") {
    store.addGap({
      runId: run.id,
      kind: "mapping_loss",
      summary: "Synthetic example: one stored App Server field has no stable protocol mapping.",
      source: "synthetic-demo",
      startAt: null,
      endAt: null
    });
  }
  if (input.correction) {
    store.addCorrection({
      runId: run.id,
      kind: "instruction",
      text: "Synthetic correction: verify cache expiry before changing the invalidation rule.",
      targetEventIds: [],
      redacted: false
    });
  }
}

const store = new WorkbenchStore(join(dataDir, "workbench.sqlite3"));
addSyntheticRun(store, {
  sessionId: "synthetic-cache-failure",
  mode: "observed",
  goal: "Fix cache invalidation in the demo weather widget",
  startedAt: "2026-08-28T08:30:00.000Z",
  completeness: "partial",
  outcome: "failure",
  correction: true
});
addSyntheticRun(store, {
  sessionId: "synthetic-protection",
  mode: "managed",
  goal: "Protect the demo forecast rendering path",
  startedAt: "2026-08-28T08:00:00.000Z",
  completeness: "complete",
  outcome: "success",
  correction: false
});
addSyntheticRun(store, {
  sessionId: "synthetic-command-gap",
  mode: "observed",
  goal: "Update the demo cache documentation",
  startedAt: "2026-08-28T07:30:00.000Z",
  completeness: "partial",
  outcome: "success",
  correction: false
});
store.close();

const server = spawn(process.execPath, [join(root, "dist", "server", "index.js")], {
  cwd: root,
  env: { ...process.env, REW_DATA_DIR: dataDir, REW_PORT: String(port), REW_HOST: "127.0.0.1" },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"]
});

async function waitForHealth() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error("Synthetic screenshot service exited before becoming healthy.");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      const body = await response.json();
      if (response.ok && body.product === "runtime-evolution-workbench") return;
    } catch {
      // The loop is bounded and only targets the synthetic local service.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));
  }
  throw new Error("Synthetic screenshot service did not become healthy.");
}

let browser;
try {
  await waitForHealth();
  const token = readFileSync(join(dataDir, "session-token"), "utf8").trim();
  browser = await chromium.launch({ headless: true, ...(browserChannel ? { channel: browserChannel } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const browserErrors = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/session/${token}`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Runs", exact: true }).waitFor();
  await page.screenshot({ path: join(outputDir, "ui-desktop-runs-synthetic.png"), fullPage: true });
  const runCount = await page.locator(".run-row").count();
  const gapCount = await page.locator(".gap-row").count();
  const syntheticCopyVisible = await page.getByText(/Synthetic example:/).isVisible();
  let protocolImportCount = null;
  if (protocolFixture) {
    await page.getByRole("button", { name: "Open protocol library" }).click();
    await page.locator('.protocol-modal input[type="file"]').setInputFiles(protocolFixture);
    await page.getByText("workflow.case.v1", { exact: true }).waitFor();
    protocolImportCount = await page.locator(".protocol-list article").count();
    await page.getByRole("button", { name: "Close protocol library" }).click();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.screenshot({ path: join(outputDir, "ui-mobile-menu-synthetic.png"), fullPage: true });
  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  const result = {
    data: "fully synthetic",
    runCount,
    gapCount,
    syntheticCopyVisible,
    protocolImportCount,
    noHorizontalOverflow: overflow.scrollWidth <= overflow.viewport,
    browserErrors,
    outputs: [
      join(outputDir, "ui-desktop-runs-synthetic.png"),
      join(outputDir, "ui-mobile-menu-synthetic.png")
    ]
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (
    result.runCount !== 3
    || result.gapCount < 1
    || !result.syntheticCopyVisible
    || (protocolFixture && result.protocolImportCount !== 1)
    || !result.noHorizontalOverflow
    || result.browserErrors.length > 0
  ) {
    throw new Error("Synthetic Runtime UI acceptance failed");
  }
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null) {
    const serverClosed = new Promise((resolvePromise) => server.once("close", resolvePromise));
    server.kill();
    await serverClosed;
  }
  rmSync(scratchDir, { recursive: true, force: true });
}

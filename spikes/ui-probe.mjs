import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
if (!process.env.REW_PLAYWRIGHT_MODULE) throw new Error("Set REW_PLAYWRIGHT_MODULE to an installed Playwright module path.");
if (!process.env.REW_DATA_DIR) throw new Error("Set REW_DATA_DIR to the local acceptance-evidence data directory.");
const { chromium } = require(process.env.REW_PLAYWRIGHT_MODULE);

const dataDir = resolve(process.env.REW_DATA_DIR);
const token = readFileSync(join(dataDir, "session-token"), "utf8").trim();
const baseUrl = process.env.REW_BASE_URL ?? "http://127.0.0.1:43119";
const evidenceDir = resolve("evidence");
mkdirSync(evidenceDir, { recursive: true });

const browser = await chromium.launch({
  channel: "msedge",
  headless: true
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", (error) => consoleErrors.push(error.message));

try {
  await page.goto(`${baseUrl}/session/${token}`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Runs", exact: true }).waitFor();
  const runRows = page.locator(".run-row");
  const runCount = await runRows.count();
  if (runCount < 1) throw new Error("Runs page rendered no retained Run rows");
  await page.locator(".run-titlebar h1").waitFor();
  const partialEvidenceVisible = await page.getByText("Partial evidence", { exact: true }).first().isVisible();
  const gapCount = await page.locator(".gap-row").count();
  await page.screenshot({ path: join(evidenceDir, "ui-desktop-runs.png"), fullPage: true });

  await page.getByRole("button", { name: /Issues/ }).click();
  await page.getByRole("heading", { name: "Issues", exact: true }).waitFor();
  const issuesEmpty = await page.getByText("No issue candidates yet", { exact: true }).isVisible();
  await page.getByRole("button", { name: /Evolution Lab/ }).click();
  await page.getByRole("heading", { name: "Evolution Lab", exact: true }).waitFor();
  const evolutionEmpty = await page.getByText("No capability proposal yet", { exact: true }).isVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  const mobileNavVisible = await page.locator(".sidebar.sidebar-open").isVisible();
  await page.screenshot({ path: join(evidenceDir, "ui-mobile-menu.png"), fullPage: true });
  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth
  }));

  process.stdout.write(`${JSON.stringify({
    browser: "Microsoft Edge via bundled Playwright",
    reason: "Browser plugin was unavailable in this session; frontend-testing skill fallback used local Playwright.",
    desktop: { runCount, partialEvidenceVisible, gapCount, issuesEmpty, evolutionEmpty },
    mobile: { mobileNavVisible, overflow, noHorizontalOverflow: overflow.scrollWidth <= overflow.viewport && overflow.bodyScrollWidth <= overflow.viewport },
    consoleErrors,
    screenshots: [join(evidenceDir, "ui-desktop-runs.png"), join(evidenceDir, "ui-mobile-menu.png")]
  }, null, 2)}\n`);
} finally {
  await browser.close();
}

import { createRequire } from "node:module";

const sessionUrl = process.env.REW_SESSION_URL;
const fixturePath = process.env.REW_PROTOCOL_FIXTURE;
if (!sessionUrl || !fixturePath) {
  throw new Error("REW_SESSION_URL and REW_PROTOCOL_FIXTURE are required");
}

const require = createRequire(import.meta.url);
const playwrightModule = process.env.REW_PLAYWRIGHT_MODULE ?? "playwright";
const { chromium } = require(playwrightModule);
const executablePath = process.env.REW_BROWSER_EXECUTABLE;
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {})
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const browserErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") browserErrors.push(message.text());
});
page.on("pageerror", (error) => browserErrors.push(error.message));

try {
  await page.goto(sessionUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Protocol library" }).click();
  await page.locator('input[type="file"]').setInputFiles(fixturePath);
  await page.getByText("workflow.case.v1", { exact: true }).waitFor();

  const imported = await page.evaluate(async () => {
    const listResponse = await fetch("/api/protocol/imports");
    const list = await listResponse.json();
    const metadata = list.documents[0];
    const detailResponse = await fetch(`/api/protocol/imports/${metadata.id}`);
    const detail = await detailResponse.json();
    return {
      count: list.documents.length,
      schemaVersion: metadata.schemaVersion,
      externalId: metadata.externalId,
      secretRefsPreserved: Array.isArray(detail.document?.safety?.secret_refs)
    };
  });

  const result = {
    imported,
    emptyRunBoundaryVisible: await page.getByText("No Runs retained yet", { exact: true }).isVisible(),
    browserErrors
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (
    imported.count !== 1
    || imported.schemaVersion !== "workflow.case.v1"
    || !imported.secretRefsPreserved
    || browserErrors.length > 0
  ) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}

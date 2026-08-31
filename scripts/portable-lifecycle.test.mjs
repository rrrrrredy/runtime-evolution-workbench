import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  assertDataRoot,
  assertSafeDataPath,
  commandOwnsServer,
  initializeDataRoot,
  marketplaceListingContains,
  marketplaceListingRecord,
  parseArguments,
  pluginListingContains,
  pluginListingRecord,
  removeOwnedDataRoot
} from "./portable-lifecycle.mjs";

test("portable arguments and unsafe roots fail closed", () => {
  assert.equal(parseArguments(["start", "--port", "43119"]).port, 43119);
  assert.throws(() => parseArguments(["start", "--port", "80"]), /between 1024 and 65535/);
  assert.throws(() => assertSafeDataPath("/"), /unsafe/);
});

test("Codex aligned plugin and marketplace tables are parsed exactly", () => {
  assert.equal(
    pluginListingContains(
      "runtime-evolution-workbench@runtime-evolution-workbench    installed, enabled  0.2.0  /tmp/plugin",
      "runtime-evolution-workbench@runtime-evolution-workbench"
    ),
    true
  );
  assert.equal(
    marketplaceListingContains("MARKETPLACE ROOT\nruntime-evolution-workbench  /tmp/source", "runtime-evolution-workbench"),
    true
  );
  assert.deepEqual(
    pluginListingRecord(
      "runtime-evolution-workbench@runtime-evolution-workbench    installed, enabled  0.2.0  /tmp/plugin",
      "runtime-evolution-workbench@runtime-evolution-workbench"
    ),
    {
      selector: "runtime-evolution-workbench@runtime-evolution-workbench",
      version: "0.2.0",
      path: resolve("/tmp/plugin")
    }
  );
  assert.deepEqual(
    marketplaceListingRecord("runtime-evolution-workbench  /tmp/foreign-source", "runtime-evolution-workbench"),
    { name: "runtime-evolution-workbench", root: resolve("/tmp/foreign-source") }
  );
});

test("portable service ownership requires both the server path and per-process secret", () => {
  const marker = "/opt/runtime-evolution-workbench/dist/server/index.js";
  const token = "a".repeat(64);
  assert.equal(commandOwnsServer(`node ${marker}`, marker, `REW_PROCESS_TOKEN=${token}`, token), true);
  assert.equal(commandOwnsServer("node /tmp/foreign.js", marker, `REW_PROCESS_TOKEN=${token}`, token), false);
  assert.equal(commandOwnsServer(`node ${marker}`, marker, "REW_PROCESS_TOKEN=foreign", token), false);
});

test("portable data deletion requires the exact product marker", () => {
  const root = mkdtempSync(join(tmpdir(), "rew-portable-"));
  try {
    const owned = join(root, "owned-data");
    const initialized = initializeDataRoot(owned);
    assert.equal(initialized.created, true);
    assert.equal(JSON.parse(readFileSync(join(owned, ".runtime-evolution-workbench-data.json"), "utf8")).product, "runtime-evolution-workbench");
    assert.equal(assertDataRoot(owned), owned);

    const foreign = join(root, "foreign-data");
    mkdirSync(foreign);
    writeFileSync(join(foreign, "keep.txt"), "keep", "utf8");
    assert.throws(() => removeOwnedDataRoot(foreign), /unmarked/);
    assert.equal(readFileSync(join(foreign, "keep.txt"), "utf8"), "keep");

    if (process.platform !== "win32") {
      const link = join(root, "linked-data");
      symlinkSync(owned, link, "dir");
      assert.throws(() => assertDataRoot(link), /real directory/);
    }
    removeOwnedDataRoot(owned);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

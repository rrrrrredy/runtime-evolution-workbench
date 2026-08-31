import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertDataRoot,
  assertSafeDataPath,
  initializeDataRoot,
  marketplaceListingContains,
  parseArguments,
  pluginListingContains,
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
      "runtime-evolution-workbench@runtime-evolution-workbench    installed, enabled  0.1.0  /tmp/plugin",
      "runtime-evolution-workbench@runtime-evolution-workbench"
    ),
    true
  );
  assert.equal(
    marketplaceListingContains("MARKETPLACE ROOT\nruntime-evolution-workbench  /tmp/source", "runtime-evolution-workbench"),
    true
  );
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

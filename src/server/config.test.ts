import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { ensureWorkbenchDataRoot } from "./config.js";

describe("product-owned data root", () => {
  it("creates and validates the ownership marker while rejecting a foreign directory", () => {
    const root = mkdtempSync(join(process.env.REW_TEST_TMP ?? tmpdir(), "rew-config-"));
    try {
      const owned = join(root, "owned");
      ensureWorkbenchDataRoot(owned);
      expect(JSON.parse(readFileSync(join(owned, ".runtime-evolution-workbench-data.json"), "utf8"))).toMatchObject({
        schema_version: "product.data-root.v1",
        product: "runtime-evolution-workbench"
      });
      expect(() => ensureWorkbenchDataRoot(owned)).not.toThrow();

      const existingEmpty = join(root, "existing-empty");
      mkdirSync(existingEmpty);
      expect(() => ensureWorkbenchDataRoot(existingEmpty)).toThrow(/ownership marker/);
      expect(readdirSync(existingEmpty)).toEqual([]);

      const foreign = join(root, "foreign");
      mkdirSync(foreign);
      writeFileSync(join(foreign, "keep.txt"), "keep", "utf8");
      expect(() => ensureWorkbenchDataRoot(foreign)).toThrow(/ownership marker/);
      expect(readFileSync(join(foreign, "keep.txt"), "utf8")).toBe("keep");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("lets the ordinary Hook create the same marker before its first spool envelope", () => {
    const root = mkdtempSync(join(process.env.REW_TEST_TMP ?? tmpdir(), "rew-hook-marker-"));
    try {
      const dataDir = join(root, "data");
      const hook = join(process.cwd(), "plugins", "runtime-evolution-workbench", "scripts", "capture-hook.mjs");
      const result = spawnSync(process.execPath, [hook], {
        cwd: process.cwd(),
        env: { ...process.env, REW_DATA_DIR: dataDir },
        input: JSON.stringify({ session_id: "marker-test", hook_event_name: "SessionStart", cwd: root }),
        encoding: "utf8",
        windowsHide: true
      });
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(readFileSync(join(dataDir, ".runtime-evolution-workbench-data.json"), "utf8"))).toMatchObject({
        product: "runtime-evolution-workbench"
      });
      expect(readFileSync(join(dataDir, "spool", "pending", readdirOne(join(dataDir, "spool", "pending"))), "utf8")).toContain(
        '"schema_version":"rew.hook.v1"'
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps an existing unmarked Hook directory untouched and does not block the Codex turn", () => {
    const root = mkdtempSync(join(process.env.REW_TEST_TMP ?? tmpdir(), "rew-hook-unmarked-"));
    try {
      const dataDir = join(root, "data");
      mkdirSync(dataDir);
      const hook = join(process.cwd(), "plugins", "runtime-evolution-workbench", "scripts", "capture-hook.mjs");
      const result = spawnSync(process.execPath, [hook], {
        cwd: process.cwd(),
        env: { ...process.env, REW_DATA_DIR: dataDir },
        input: JSON.stringify({ session_id: "unmarked-test", hook_event_name: "SessionStart", cwd: root }),
        encoding: "utf8",
        windowsHide: true
      });
      expect(result.status, result.stderr).toBe(0);
      expect(readdirSync(dataDir)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function readdirOne(directory: string): string {
  const files = readdirSync(directory);
  expect(files).toHaveLength(1);
  return files[0] ?? "";
}

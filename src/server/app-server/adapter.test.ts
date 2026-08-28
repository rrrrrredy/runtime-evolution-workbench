import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildManagedWorkspaceSettings } from "./adapter.js";

describe("managed App Server workspace settings", () => {
  it("binds both the thread and turn to one canonical, offline writable root", () => {
    const scratchRoot = process.env.REW_TEST_TMP ?? resolve(process.cwd(), "..", "_tmp");
    mkdirSync(scratchRoot, { recursive: true });
    const workspace = mkdtempSync(join(scratchRoot, "rew-adapter-"));
    try {
      const canonical = realpathSync.native(workspace);
      const settings = buildManagedWorkspaceSettings({ cwd: workspace, sandbox: "workspace-write" });
      expect(settings.workspaceRoot).toBe(canonical);
      expect(settings.threadStart).toEqual({
        cwd: canonical,
        runtimeWorkspaceRoots: [canonical],
        sandbox: "workspace-write"
      });
      expect(settings.turnStart).toEqual({
        cwd: canonical,
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: [canonical],
          networkAccess: false
        }
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

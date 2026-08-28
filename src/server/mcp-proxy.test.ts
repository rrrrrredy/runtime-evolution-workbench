import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("plugin MCP proxy", () => {
  it("negotiates MCP and exposes evidence/proposal tools without publish authority", () => {
    const input = [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    ].join("\n") + "\n";
    const output = execFileSync(
      process.execPath,
      [resolve("plugins/runtime-evolution-workbench/scripts/mcp-server.mjs")],
      { input, encoding: "utf8", windowsHide: true }
    );
    const responses = output.trim().split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, unknown>);
    const initialize = responses.find((entry) => entry.id === 1) as { result?: { protocolVersion?: string } } | undefined;
    const list = responses.find((entry) => entry.id === 2) as { result?: { tools?: Array<{ name: string }> } } | undefined;
    const names = list?.result?.tools?.map((tool) => tool.name) ?? [];
    expect(initialize?.result?.protocolVersion).toBe("2025-11-25");
    expect(names).toContain("rew_get_run");
    expect(names).toContain("rew_create_proposal");
    expect(names).not.toContain("rew_publish_proposal");
    expect(names).not.toContain("rew_approve_proposal");
  });
});

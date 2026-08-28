import { describe, expect, it } from "vitest";

import { describeAppServerFailure } from "./client.js";

describe("App Server failure summaries", () => {
  it("keeps the actionable server message while redacting credentials", () => {
    expect(describeAppServerFailure({ message: "windows sandbox: apply deny-read ACLs" }))
      .toBe("windows sandbox: apply deny-read ACLs");
    const protectedMessage = describeAppServerFailure({
      message: "authorization Bearer abcdefghijklmnopqrstuvwxyz failed"
    });
    expect(protectedMessage).toContain("[REDACTED:bearer-token]");
    expect(protectedMessage).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });
});

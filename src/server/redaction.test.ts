import { describe, expect, it } from "vitest";

import { redactUnknown } from "./redaction.js";

describe("redactUnknown", () => {
  it("removes named secrets and inline credentials before persistence", () => {
    const fakeApiKey = ["sk", "abcdefghijklmnop"].join("-");
    const fakeGitHubToken = `ghp_${"1234567890".repeat(3)}`;
    const fakeBearer = ["Bearer", "should-never-survive"].join(" ");
    const result = redactUnknown({
      authorization: fakeBearer,
      output: `request used ${fakeBearer}, ${fakeApiKey}, and ${fakeGitHubToken}`,
      safe: "visible"
    });
    const serialized = JSON.stringify(result.value);
    expect(serialized).not.toContain("should-never-survive");
    expect(serialized).not.toContain(fakeApiKey);
    expect(serialized).not.toContain(fakeGitHubToken);
    expect(serialized).toContain("visible");
    expect(result.redactedFieldCount).toBeGreaterThanOrEqual(3);
  });

  it("truncates oversized strings and reports the loss", () => {
    const result = redactUnknown("abcdef", { maxStringLength: 3 });
    expect(result.value).toContain("abc");
    expect(result.value).toContain("TRUNCATED");
    expect(result.truncatedFieldCount).toBe(1);
  });
});

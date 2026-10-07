import { describe, expect, it } from "vitest";
import { loadConfig, redactConfig } from "../src/config.js";

describe("redactConfig", () => {
  it("never returns secret values, including the Meta token", () => {
    const cfg = loadConfig({
      NODE_ENV: "test",
      META_IG_TOKEN: "meta-secret-value",
      META_IG_USER_ID: "17841400000000000",
      GITHUB_BOT_TOKEN: "gh-secret-value",
    });
    const out = redactConfig(cfg);
    const logged = JSON.stringify(out);
    expect(logged).not.toContain("meta-secret-value");
    expect(logged).not.toContain("gh-secret-value");
    expect(out.META_IG_TOKEN).toBe("[set]");
    expect(out.META_IG_USER_ID).toBe("17841400000000000");
  });
});

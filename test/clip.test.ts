import { describe, expect, it } from "vitest";
import { clip } from "../src/ai/clip.js";

describe("clip", () => {
  it("leaves short text alone", () => {
    expect(clip("GPU-інстанси £201.60/міс.", 100)).toBe("GPU-інстанси £201.60/міс.");
  });

  it("cuts back to a word boundary rather than mid-price", () => {
    const out = clip("GPU-інстанси від £201.60 на місяць", 24);
    expect(out).toBe("GPU-інстанси від…");
  });

  it("prefers ending on a finished sentence", () => {
    const out = clip("Найдешевший хостинг коштує 44.20 грн на місяць. Домени продаються окремо.", 60);
    expect(out).toBe("Найдешевший хостинг коштує 44.20 грн на місяць.");
  });

  it("still cuts when there is no boundary to fall back to", () => {
    expect(clip("a".repeat(50), 10)).toBe(`${"a".repeat(10)}…`);
  });
});

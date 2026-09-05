import { describe, expect, it } from "vitest";
import { detectChange, hashText } from "../src/monitor/detect.js";

const pricing = (pro: string, extra = "") =>
  ["Simple pricing", "Starter", "£19/month", "1 project", "Email support", "Professional", pro, "Unlimited projects", "Priority support", extra]
    .filter(Boolean)
    .join("\n");

describe("detectChange", () => {
  it("returns no change for identical text", () => {
    const d = detectChange("a\nb", "a\nb", { kind: "pricing" });
    expect(d.changed).toBe(false);
    expect(d.significance).toBe(0);
  });

  it("detects a price change on a pricing page as significant with a price signal", () => {
    const d = detectChange(pricing("£49/month"), pricing("£59/month"), { kind: "pricing" });
    expect(d.changed).toBe(true);
    expect(d.signals).toContain("price");
    expect(d.removed).toEqual(["£49/month"]);
    expect(d.added).toEqual(["£59/month"]);
    expect(d.significance).toBeGreaterThan(0.5);
  });

  it("treats reordered lines as no change", () => {
    const d = detectChange("Alpha\nBeta\nGamma", "Gamma\nAlpha\nBeta", { kind: "home" });
    expect(d.changed).toBe(false);
  });

  it("ignores a small wording tweak on a long page", () => {
    const filler = Array.from({ length: 80 }, (_, i) => `Paragraph ${i} about our wonderful design services for small businesses.`).join("\n");
    const d = detectChange(filler + "\nWe love our customers.", filler + "\nWe adore our customers.", { kind: "home" });
    expect(d.changed).toBe(false);
    expect(d.significance).toBeLessThan(0.15);
  });

  it("flags promo vocabulary", () => {
    const d = detectChange(pricing("£49/month"), pricing("£49/month", "Black Friday: 30% off all plans"), { kind: "pricing" });
    expect(d.changed).toBe(true);
    expect(d.signals).toEqual(expect.arrayContaining(["promo", "percentage"]));
  });

  it("flags launch vocabulary on a products page", () => {
    const d = detectChange("Products\nAcme Design\nAcme Proof", "Products\nAcme Design\nAcme Proof\nAcme Invoice\nNow available. Introducing our newest product.", { kind: "products" });
    expect(d.changed).toBe(true);
    expect(d.signals).toContain("launch");
  });

  it("drops noise-only lines such as bare placeholders", () => {
    const d = detectChange("Hello\n<date>\nWorld", "Hello\n<time>\nWorld", { kind: "home" });
    expect(d.changed).toBe(false);
  });

  it("respects a custom threshold", () => {
    const strict = detectChange(pricing("£49/month"), pricing("£59/month"), { kind: "pricing", threshold: 0.99 });
    expect(strict.changed).toBe(false);
  });
});

describe("hashText", () => {
  it("is stable and content-sensitive", () => {
    expect(hashText("a")).toBe(hashText("a"));
    expect(hashText("a")).not.toBe(hashText("b"));
  });
});

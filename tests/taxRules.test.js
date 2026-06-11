import { describe, it, expect } from "vitest";
import { applyTax, netRate, getTaxRule, taxRateLabel } from "../src/portfolio/taxRules.js";

describe("taxRules", () => {
  it("ОВДП coupon is tax-free", () => {
    expect(netRate("ovdp", "coupon")).toBe(1);
    expect(applyTax(1000, "ovdp", "coupon")).toBe(1000);
  });

  it("corporate coupon taxed 18% PDFO + 5% military = 23%", () => {
    expect(netRate("corporate", "coupon")).toBeCloseTo(0.77, 10);
    expect(applyTax(1000, "corporate", "coupon")).toBeCloseTo(770, 6);
  });

  it("unknown bond type falls back to no tax", () => {
    expect(netRate("unknown", "coupon")).toBe(1);
    expect(getTaxRule("unknown")).toEqual({ pdfo: 0, militaryTax: 0 });
  });

  it("label reflects the rate", () => {
    expect(taxRateLabel("ovdp")).toBe("Без податків");
    expect(taxRateLabel("corporate", "coupon")).toContain("23");
  });
});

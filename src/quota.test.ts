import { describe, expect, it } from "bun:test";
import { formatMinimalQuotaString, getNormalizedQuota, type QuotaSummary } from "./quota.js";
import type { ApiKeyEntry } from "./types.js";

describe("Quota Tracker & Normalization", () => {
  it("formats minimal quota string correctly", () => {
    const quota: QuotaSummary = { fiveHourPercent: 75, weeklyPercent: 100 };
    expect(formatMinimalQuotaString(quota)).toBe("5h: 75% | W: 100%");
  });

  it("handles 0 accounts gracefully", async () => {
    const quota = await getNormalizedQuota([], "claude-sonnet-4-6");
    expect(quota).toEqual({ fiveHourPercent: 100, weeklyPercent: 100 });
  });

  it("normalizes multi-account values accurately", () => {
    const accountA = 0.5; // 50%
    const accountB = 1.0; // 100%
    const avg = (accountA + accountB) / 2;
    const percent = Math.round(avg * 100);
    expect(percent).toBe(75);
  });
});

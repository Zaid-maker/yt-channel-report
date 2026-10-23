import test from "node:test";
import assert from "node:assert/strict";
import {
  formatWatchTime,
  getGoogleErrorDetails,
  getNetSubscribers,
  getUtcDateRange,
  isQuotaExhausted,
  isRetryableRateLimit,
  selectLatestDailyRow,
} from "../src/report-utils.js";

test("extracts Google API status, reasons, and message", () => {
  const details = getGoogleErrorDetails({
    response: {
      status: 403,
      data: { error: {
        message: "Quota exceeded",
        errors: [{ reason: "quotaExceeded" }],
        details: [{ reason: "dailyLimitExceeded" }],
      } },
    },
  });
  assert.deepEqual(details, {
    status: 403,
    reasons: ["quotaExceeded", "dailyLimitExceeded"],
    message: "Quota exceeded",
  });
});

test("uses useful fallbacks for incomplete Google errors", () => {
  assert.deepEqual(getGoogleErrorDetails({ code: 500, message: "Oops" }), {
    status: 500, reasons: [], message: "Oops",
  });
  assert.equal(getGoogleErrorDetails({}).message, "Unknown Google API error");
});

test("recognizes retryable HTTP and Google API rate-limit errors", () => {
  assert.equal(isRetryableRateLimit({ status: 429, reasons: [] }), true);
  for (const reason of ["rateLimitExceeded", "userRateLimitExceeded", "backendError"]) {
    assert.equal(isRetryableRateLimit({ status: 403, reasons: [reason] }), true);
  }
  assert.equal(isRetryableRateLimit({ status: 403, reasons: ["forbidden"] }), false);
});

test("recognizes hard quota exhaustion but not ordinary errors", () => {
  assert.equal(isQuotaExhausted({ reasons: ["quotaExceeded"] }), true);
  assert.equal(isQuotaExhausted({ reasons: ["dailyLimitExceeded"] }), true);
  assert.equal(isQuotaExhausted({ reasons: ["rateLimitExceeded"] }), false);
});

test("returns the previous seven complete UTC dates", () => {
  assert.deepEqual(getUtcDateRange(new Date("2026-10-24T12:00:00Z")), {
    startDate: "2026-10-17", endDate: "2026-10-23",
  });
  assert.deepEqual(getUtcDateRange(new Date("2026-01-01T00:10:00Z")), {
    startDate: "2025-12-24", endDate: "2025-12-31",
  });
});

test("selects the latest daily row without mutating the input", () => {
  const headers = [{ name: "day" }, { name: "views" }];
  const rows = [["2026-10-21", 12], ["2026-10-23", 30], ["2026-10-22", 20]];
  assert.deepEqual(selectLatestDailyRow(headers, rows), ["2026-10-23", 30]);
  assert.deepEqual(rows[0], ["2026-10-21", 12]);
});

test("returns no row when the day dimension or data is missing", () => {
  assert.equal(selectLatestDailyRow([{ name: "views" }], [[12]]), null);
  assert.equal(selectLatestDailyRow([{ name: "day" }], []), null);
});

test("formats watch time and calculates net subscribers", () => {
  assert.equal(formatWatchTime(125), "2h 5m");
  assert.equal(formatWatchTime(0), "0h 0m");
  assert.equal(formatWatchTime(undefined), "0h 0m");
  assert.equal(getNetSubscribers(14, 5), 9);
  assert.equal(getNetSubscribers(2, 7), -5);
  assert.equal(getNetSubscribers(undefined, undefined), 0);
});

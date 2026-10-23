export const getGoogleErrorDetails = (error) => {
  const apiError = error?.response?.data?.error;
  const reasons = [
    ...(apiError?.errors ?? []).map((item) => item.reason),
    ...(apiError?.details ?? []).map((item) => item.reason),
  ].filter(Boolean);
  return {
    status: error?.response?.status ?? error?.code,
    reasons,
    message: apiError?.message || error?.message || "Unknown Google API error",
  };
};

export const isRetryableRateLimit = (details) =>
  details.status === 429 ||
  details.reasons.some((reason) =>
    ["rateLimitExceeded", "userRateLimitExceeded", "backendError"].includes(reason)
  );

export const isQuotaExhausted = (details) =>
  details.reasons.some((reason) =>
    ["quotaExceeded", "dailyLimitExceeded"].includes(reason)
  );

export const getUtcDateRange = (now = new Date()) => {
  const endDate = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const rangeStart = new Date(`${endDate}T00:00:00Z`);
  rangeStart.setUTCDate(rangeStart.getUTCDate() - 6);
  return { startDate: rangeStart.toISOString().slice(0, 10), endDate };
};

export const selectLatestDailyRow = (headers, rows) => {
  const dayIndex = headers.findIndex((header) => header.name === "day");
  if (dayIndex < 0 || !rows?.length) return null;
  return [...rows].sort((a, b) =>
    String(b[dayIndex]).localeCompare(String(a[dayIndex]))
  )[0];
};

export const formatWatchTime = (minutes) => {
  const total = Number(minutes ?? 0);
  return `${Math.floor(total / 60)}h ${Math.round(total % 60)}m`;
};

export const getNetSubscribers = (gained, lost) =>
  Number(gained ?? 0) - Number(lost ?? 0);

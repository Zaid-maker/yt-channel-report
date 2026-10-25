import { google } from "googleapis";
import {
  formatWatchTime,
  getGoogleErrorDetails,
  getNetSubscribers,
  getUtcDateRange,
  isQuotaExhausted,
  isRetryableRateLimit,
  selectLatestDailyRow,
} from "./report-utils.js";

const required = [
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_REFRESH_TOKEN",
  "YOUTUBE_CHANNEL_ID",
  "SLACK_WEBHOOK_URL"
];
for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}

const oauth2 = new google.auth.OAuth2(
  process.env.YOUTUBE_CLIENT_ID,
  process.env.YOUTUBE_CLIENT_SECRET
);
oauth2.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });

const youtubeAnalytics = google.youtubeAnalytics({ version: "v2", auth: oauth2 });
const channelId = process.env.YOUTUBE_CHANNEL_ID;
const channelUrl = `https://www.youtube.com/channel/${encodeURIComponent(channelId)}`;
const decodeHtml = (value = "") => value
  .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x27;/g, "'");

const getMeta = (html, key) => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i")
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return "";
};

let channelName = "YouTube channel";
let channelLogoUrl;
let channelDescription = "";
let channelHandle = "";
try {
  const pageResponse = await fetch(channelUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; YouTubeSlackReport/1.0)" },
    signal: AbortSignal.timeout(12000)
  });
  if (pageResponse.ok) {
    const html = await pageResponse.text();
    channelName = getMeta(html, "og:title") || channelName;
    channelLogoUrl = getMeta(html, "og:image") || undefined;
    channelDescription = getMeta(html, "og:description") || getMeta(html, "description");
    const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
      || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
    const canonicalUrl = canonical?.[1] ? decodeHtml(canonical[1]) : "";
    const handleMatch = canonicalUrl.match(/youtube\.com\/(?:@[^/?#]+|user\/[^/?#]+|c\/[^/?#]+)/i);
    if (handleMatch) channelHandle = handleMatch[0].replace("youtube.com/", "");
    if (!channelHandle) {
      const vanity = html.match(/"vanityChannelUrl":"([^"]+)"/);
      if (vanity?.[1]) channelHandle = decodeHtml(vanity[1]).replace(/^.*youtube\.com\//, "");
    }
  } else {
    console.warn(`Public channel page returned HTTP ${pageResponse.status}; continuing with limited channel metadata.`);
  }
} catch (error) {
  console.warn(`Could not fetch public channel metadata; continuing without it: ${error.message}`);
}

const { startDate, endDate } = getUtcDateRange();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function queryAnalytics(params) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await youtubeAnalytics.reports.query({
        ids: `channel==${channelId}`,
        startDate,
        endDate,
        ...params
      });
    } catch (error) {
      const details = getGoogleErrorDetails(error);
      if (isQuotaExhausted(details)) throw error;
      if (!isRetryableRateLimit(details) || attempt >= 3) throw error;
      const retryAfter = Number(error?.response?.headers?.["retry-after"]);
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 60000)
        : Math.min(1000 * (2 ** attempt), 8000);
      console.warn(`YouTube API rate-limited the request. Retry ${attempt + 1}/3 in ${Math.ceil(delayMs / 1000)}s.`);
      await sleep(delayMs);
    }
  }
}

let dailyResponse;
try {
  dailyResponse = await queryAnalytics({
    dimensions: "day",
    metrics: "views,estimatedMinutesWatched,subscribersGained,subscribersLost,likes,comments,shares",
    sort: "day"
  });
} catch (error) {
  const details = getGoogleErrorDetails(error);
  if (isQuotaExhausted(details)) {
    const warning = { text: `⚠️ YouTube report skipped for *${channelName}*: the YouTube API quota is exhausted. No analytics were reported as zero. The next scheduled run will try again.` };
    try {
      const slackResponse = await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(warning),
        signal: AbortSignal.timeout(12000)
      });
      if (!slackResponse.ok) console.error(`Could not send quota warning to Slack (${slackResponse.status}).`);
    } catch (slackError) {
      console.error(`Could not send quota warning to Slack: ${slackError.message}`);
    }
    console.warn(`YouTube API quota exhausted (${details.reasons.join(", ") || details.status}). Skipping this run.`);
    process.exit(0);
  }
  throw error;
}

const dailyHeaders = dailyResponse.data.columnHeaders ?? [];
const dailyRows = dailyResponse.data.rows ?? [];
const row = selectLatestDailyRow(dailyHeaders, dailyRows);
if (!row) {
  console.error(`YouTube Analytics returned no daily rows for channel ${channelId} between ${startDate} and ${endDate}.`);
  console.error(`Returned column headers: ${dailyHeaders.map((header) => header.name).join(", ") || "(none)"}`);
  throw new Error("No daily YouTube Analytics rows returned; refusing to send a misleading all-zero report.");
}
const dayIndex = dailyHeaders.findIndex((header) => header.name === "day");
const reportDate = String(row[dayIndex]);
const valueMap = (headers, values) => Object.fromEntries(
  headers.map((header, index) => [header.name, values[index] ?? 0])
);
const values = valueMap(dailyHeaders, row);
const previousRow = dailyRows
  .filter((candidate) => String(candidate[dayIndex]) < reportDate)
  .sort((a, b) => String(b[dayIndex]).localeCompare(String(a[dayIndex])))[0];
const previousValues = previousRow ? valueMap(dailyHeaders, previousRow) : null;

const n = (value) => Number(value ?? 0).toLocaleString("en-US");
const signed = (value) => `${Number(value) > 0 ? "+" : ""}${n(value)}`;
const pct = (value) => `${Number(value).toFixed(1)}%`;
const watchTime = formatWatchTime(values.estimatedMinutesWatched);
const netSubs = getNetSubscribers(values.subscribersGained, values.subscribersLost);
const engagementCount = Number(values.likes) + Number(values.comments) + Number(values.shares);
const engagementRate = Number(values.views) > 0 ? engagementCount / Number(values.views) * 100 : null;
const averageViewDuration = Number(values.views) > 0
  ? Number(values.estimatedMinutesWatched) * 60 / Number(values.views)
  : null;
const growthText = (current, previous) => {
  if (!previous || Number(previous) === 0) return "n/a";
  const change = (Number(current) - Number(previous)) / Math.abs(Number(previous)) * 100;
  return `${change > 0 ? "+" : ""}${pct(change)}`;
};

const channelDetails = [
  channelHandle ? `Handle: ${channelHandle}` : null,
  `Channel ID: ${channelId}`,
  `[Open channel](${channelUrl})`,
  channelDescription ? channelDescription.replace(/\s+/g, " ").slice(0, 220) : null
].filter(Boolean).join(" · ");
const fields = [
  { type: "mrkdwn", text: `*Views*\n${n(values.views)}` },
  { type: "mrkdwn", text: `*Watch time*\n${watchTime}` },
  { type: "mrkdwn", text: `*Subscribers gained*\n+${n(values.subscribersGained)}` },
  { type: "mrkdwn", text: `*Subscribers lost*\n-${n(values.subscribersLost)}` },
  { type: "mrkdwn", text: `*Net subscribers*\n${signed(netSubs)}` },
  { type: "mrkdwn", text: `*Likes · Comments · Shares*\n${n(values.likes)} · ${n(values.comments)} · ${n(values.shares)}` },
  { type: "mrkdwn", text: `*Engagement rate*\n${engagementRate === null ? "n/a" : pct(engagementRate)}` },
  { type: "mrkdwn", text: `*Avg. view duration*\n${averageViewDuration === null ? "n/a" : formatWatchTime(averageViewDuration / 60)}` },
  { type: "mrkdwn", text: `*Views vs previous available day*\n${growthText(values.views, previousValues?.views)}` },
  { type: "mrkdwn", text: `*Net subscribers vs previous available day*\n${previousValues ? signed(netSubs - getNetSubscribers(previousValues.subscribersGained, previousValues.subscribersLost)) : "n/a"}` }
];

const blocks = [
  { type: "section", text: { type: "mrkdwn", text: `*${channelName}*` }, ...(channelLogoUrl ? { accessory: { type: "image", image_url: channelLogoUrl, alt_text: `${channelName} channel logo` } } : {}) },
  { type: "section", text: { type: "mrkdwn", text: channelDetails } },
  { type: "header", text: { type: "plain_text", text: `📊 Daily report · ${reportDate}`, emoji: true } },
  { type: "section", fields },
  { type: "context", elements: [{ type: "mrkdwn", text: `Engagement rate = (likes + comments + shares) / views. Data window checked: ${startDate} to ${endDate} UTC. Daily data can be delayed or revised.` }] }
];

blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "Source: YouTube Analytics API · Public channel/video metadata is best-effort. Only authorized channel analytics are available." }] });

const message = {
  text: `📊 ${channelName} — YouTube daily report · ${reportDate}`,
  blocks
};
const slackResponse = await fetch(process.env.SLACK_WEBHOOK_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(message),
  signal: AbortSignal.timeout(15000)
});
if (!slackResponse.ok) {
  throw new Error(`Slack webhook failed (${slackResponse.status}): ${await slackResponse.text()}`);
}
console.log(`Sent YouTube report for ${reportDate} to Slack with channel metadata, engagement, and growth.`);

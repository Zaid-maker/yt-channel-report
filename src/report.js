import { google } from "googleapis";

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
const youtubeData = google.youtube({ version: "v3", auth: oauth2 });
const channelResponse = await youtubeData.channels.list({ part: ["snippet"], id: [channelId] });
const channelSnippet = channelResponse.data.items?.[0]?.snippet;
const channelName = channelSnippet?.title || "YouTube channel";
const channelLogoUrl = channelSnippet?.thumbnails?.high?.url || channelSnippet?.thumbnails?.medium?.url || channelSnippet?.thumbnails?.default?.url;

// Analytics data can arrive late. Query the previous seven complete UTC dates
// by day, then report the most recent day for which the API returned a row.
const endDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
  .toISOString().slice(0, 10);
const rangeStart = new Date(`${endDate}T00:00:00Z`);
rangeStart.setUTCDate(rangeStart.getUTCDate() - 6);
const startDate = rangeStart.toISOString().slice(0, 10);

const response = await youtubeAnalytics.reports.query({
  ids: `channel==${channelId}`,
  startDate,
  endDate,
  dimensions: "day",
  metrics: "views,estimatedMinutesWatched,subscribersGained,subscribersLost,likes,comments,shares",
});

const headers = response.data.columnHeaders ?? [];
const dayIndex = headers.findIndex((header) => header.name === "day");
const rows = response.data.rows ?? [];
const row = dayIndex < 0 ? null : [...rows].sort((a, b) => String(b[dayIndex]).localeCompare(String(a[dayIndex])))[0];

if (!row) {
  console.error(`YouTube Analytics returned no daily rows for channel ${channelId} between ${startDate} and ${endDate}.`);
  console.error(`Returned column headers: ${headers.map((header) => header.name).join(", ") || "(none)"}`);
  throw new Error("No daily YouTube Analytics rows returned for the seven-day window; refusing to send a misleading all-zero report.");
}

const reportDate = String(row[dayIndex]);
console.log(`YouTube Analytics returned ${rows.length} daily row(s) from ${startDate} to ${endDate}; reporting the latest available day: ${reportDate}.`);
const values = Object.fromEntries(
  headers.filter((header) => header.name !== "day").map((header, i) => {
    const originalIndex = headers.findIndex((candidate) => candidate.name === header.name);
    return [header.name, row[originalIndex] ?? 0];
  })
);
const n = (value) => Number(value ?? 0).toLocaleString("en-US");
const watchMinutes = Number(values.estimatedMinutesWatched ?? 0);
const watchTime = `${Math.floor(watchMinutes / 60)}h ${Math.round(watchMinutes % 60)}m`;
const netSubs = Number(values.subscribersGained ?? 0) - Number(values.subscribersLost ?? 0);

const message = {
  text: `📊 *${channelName} — YouTube daily report · ${reportDate}*`,
  blocks: [
    { type: "section", text: { type: "mrkdwn", text: `*${channelName}*` }, ...(channelLogoUrl ? { accessory: { type: "image", image_url: channelLogoUrl, alt_text: `${channelName} channel logo` } } : {}) },
    { type: "header", text: { type: "plain_text", text: `📊 Daily report · ${reportDate}`, emoji: true } },
    { type: "section", fields: [
      { type: "mrkdwn", text: `*Views*\n${n(values.views)}` },
      { type: "mrkdwn", text: `*Watch time*\n${watchTime}` },
      { type: "mrkdwn", text: `*Subscribers gained*\n+${n(values.subscribersGained)}` },
      { type: "mrkdwn", text: `*Subscribers lost*\n-${n(values.subscribersLost)}` },
      { type: "mrkdwn", text: `*Net subscribers*\n${netSubs >= 0 ? "+" : ""}${n(netSubs)}` },
      { type: "mrkdwn", text: `*Likes · Comments · Shares*\n${n(values.likes)} · ${n(values.comments)} · ${n(values.shares)}` }
    ]},
    { type: "context", elements: [
      { type: "mrkdwn", text: "Source: YouTube Analytics API · Daily data can be delayed or revised by YouTube." }
    ]}
  ]
};

const slackResponse = await fetch(process.env.SLACK_WEBHOOK_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(message)
});
if (!slackResponse.ok) {
  throw new Error(`Slack webhook failed (${slackResponse.status}): ${await slackResponse.text()}`);
}
console.log(`Sent YouTube report for ${reportDate} to Slack.`);

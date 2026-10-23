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

// Analytics reports are finalized with a delay. Report the previous complete
// calendar day in UTC; for many channels this is the closest reliable daily report.
const reportDate = new Date(Date.now() - 24 * 60 * 60 * 1000)
  .toISOString().slice(0, 10);

const response = await youtubeAnalytics.reports.query({
  ids: `channel==${channelId}`,
  startDate: reportDate,
  endDate: reportDate,
  metrics: "views,estimatedMinutesWatched,subscribersGained,subscribersLost,likes,comments,shares",
  dimensions: "day"
});

const row = response.data.rows?.[0] ?? [];
const values = Object.fromEntries(
  (response.data.columnHeaders ?? []).map((header, i) => [header.name, row[i] ?? 0])
);
const n = (value) => Number(value ?? 0).toLocaleString("en-US");
const watchMinutes = Number(values.estimatedMinutesWatched ?? 0);
const watchTime = `${Math.floor(watchMinutes / 60)}h ${Math.round(watchMinutes % 60)}m`;
const netSubs = Number(values.subscribersGained ?? 0) - Number(values.subscribersLost ?? 0);

const message = {
  text: `📊 *YouTube daily report — ${reportDate}*`,
  blocks: [
    { type: "header", text: { type: "plain_text", text: `📊 YouTube daily report · ${reportDate}`, emoji: true } },
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

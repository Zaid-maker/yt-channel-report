# YouTube → Slack daily report

A free GitHub Actions bot that posts a daily YouTube Analytics summary to a Slack channel. It reports views, watch time, subscribers gained/lost/net, likes, comments, and shares for the previous UTC calendar day. YouTube Analytics data may be delayed or revised, so this is not a guaranteed rolling 24-hour real-time window.

## 1. Create a Slack incoming webhook

1. Open https://api.slack.com/apps and create an app for your workspace.
2. Enable **Incoming Webhooks**.
3. Add a webhook to the channel where reports should appear.
4. Copy the webhook URL. Treat it like a password; don't commit it to the repo.

## 2. Enable YouTube APIs

1. Open https://console.cloud.google.com/ and create/select a Google Cloud project.
2. Enable **YouTube Analytics API** and **YouTube Data API v3**. The Analytics API provides report metrics; the Data API supplies the channel name and logo shown in Slack.
3. Configure the OAuth consent screen and create an OAuth client ID (Desktop app is a common option for a one-time local OAuth flow).
4. Authorize the Google account that owns/manages the YouTube channel with the read-only analytics scope:
   `https://www.googleapis.com/auth/yt-analytics.readonly`
5. Obtain an OAuth **refresh token** for that account. The exact steps depend on your OAuth app's publishing/testing status. If the app remains in Testing, refresh tokens for external users may expire after 7 days. Use an appropriate production configuration for a durable setup.
6. Use the channel ID (usually starts with `UC...`), not the `@handle`.

This project deliberately does not ask for your Google password or store credentials in source code.

## 3. Add GitHub repository secrets

In your repo, go to **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret | Value |
|---|---|
| `YOUTUBE_CLIENT_ID` | OAuth client ID |
| `YOUTUBE_CLIENT_SECRET` | OAuth client secret |
| `YOUTUBE_REFRESH_TOKEN` | OAuth refresh token |
| `YOUTUBE_CHANNEL_ID` | Channel ID beginning `UC...` |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook URL |

Never put these values directly in the workflow or source files.

## 4. Run it

Commit the files to a GitHub repository. Open **Actions → YouTube daily Slack report → Run workflow** for a manual test. Scheduled runs are at **00:15 UTC / 05:15 Pakistan time** daily. GitHub Actions scheduled runs can be delayed occasionally.

## Metrics and limitations

- Reports the previous UTC calendar day, rather than a perfectly rolling 24-hour interval.
- Uses YouTube Analytics API, so the Google account must have permission to access that channel's analytics.
- If you want a public channel you do not own/manage, YouTube Analytics metrics are not available to you. Public subscriber count and public video statistics can be fetched separately, but they do not provide the channel's private 24-hour watch time or subscriber gains/losses.
- No revenue is included by default because revenue metrics are not available to every channel.
- If there are no rows yet for the date, the bot sends zeros; YouTube may still be processing the report.

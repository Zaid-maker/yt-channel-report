# YouTube → Slack daily report

A free GitHub Actions bot that posts a daily YouTube Analytics summary to a Slack channel. It reports public channel metadata, views, watch time, subscriber changes, engagement rate, and day-over-day growth. The workflow checks the previous seven complete UTC dates and reports the **latest daily row returned by YouTube Analytics**. Analytics data can be delayed or revised, so the report date may be earlier than yesterday.

The workflow runs in GitHub Actions; the OAuth refresh-token generator runs **locally on your own computer**. Never put credentials or tokens in source code.

## What you'll need

- A Google account with permission to view the target channel's YouTube Analytics (usually the channel owner or an authorized manager).
- Node.js 20 or newer and Git.
- A Slack workspace where you can add an incoming webhook.
- A GitHub account.

> **Important:** YouTube Analytics does not expose private analytics for arbitrary public channels. You must be authorized to access the channel's analytics.

## 1. Clone and install

```bash
git clone https://github.com/Zaid-maker/yt-channel-report.git
cd yt-channel-report
npm install
```

## 2. Create the Slack incoming webhook

1. Open [Slack API apps](https://api.slack.com/apps) and create an app for your workspace.
2. Enable **Incoming Webhooks**.
3. Add a webhook to the channel where reports should appear.
4. Copy the webhook URL and keep it private. You'll add it to GitHub Secrets later.

## 3. Set up Google OAuth

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. Enable **YouTube Analytics API**. The current code gets the channel name and avatar from its public YouTube channel page, so enabling YouTube Data API v3 is not required.
3. Configure the Google OAuth consent screen. Add your Google account as a test user if the app is in Testing.
4. Create an OAuth client ID with application type **Desktop app** and copy its client ID and client secret.
5. The account you authorize must have analytics access to the channel.

## 4. Generate the refresh token (included in this repository)

You do **not** need to find or trust a separate token-generator repository. This project includes `scripts/generate-token.js`.

The generator runs on your computer, starts a temporary local callback server on port 3000, and prints the refresh token in your terminal after you approve access. The token is not committed to the repository.

Set your OAuth client credentials in your **local terminal** first.

**macOS / Linux (bash):**

```bash
export YOUTUBE_CLIENT_ID='your-desktop-client-id'
export YOUTUBE_CLIENT_SECRET='your-desktop-client-secret'
npm run generate-token
```

**Windows PowerShell:**

```powershell
$env:YOUTUBE_CLIENT_ID = "your-desktop-client-id"
$env:YOUTUBE_CLIENT_SECRET = "your-desktop-client-secret"
npm run generate-token
```

Then:

1. Open the Google authorization URL printed in the terminal.
2. Sign in with the Google account that has access to the channel's analytics and approve access.
3. Your browser redirects to the local callback. Return to the terminal and copy the printed refresh token.
4. If Google does not return a refresh token, remove the app's existing access from your [Google Account third-party connections](https://myaccount.google.com/connections), then run the generator again and approve access.
5. Keep the token private. Do not paste it into source files, commit it, or share it publicly.

The generator uses the read-only scope `https://www.googleapis.com/auth/yt-analytics.readonly`. It does not ask for your Google password. Port **3000** must be available while the generator runs.

### OAuth Testing-mode expiry warning

If the OAuth consent screen is configured as **External** and its publishing status is **Testing**, refresh tokens can expire after seven days for scopes beyond basic identity scopes. For a long-running daily report, review the consent-screen publishing status and Google's verification requirements for your situation. Do not assume a token created in Testing mode will work indefinitely.

## 5. Add GitHub Actions secrets

In your GitHub repository, open **Settings → Secrets and variables → Actions → New repository secret**. Add all five secrets:

| Secret name | Value |
|---|---|
| `YOUTUBE_CLIENT_ID` | Desktop OAuth client ID |
| `YOUTUBE_CLIENT_SECRET` | Desktop OAuth client secret |
| `YOUTUBE_REFRESH_TOKEN` | Token printed by `npm run generate-token` |
| `YOUTUBE_CHANNEL_ID` | YouTube channel ID, usually beginning with `UC` (not the `@handle`) |
| `SLACK_WEBHOOK_URL` | Slack incoming webhook URL |

Never put these values directly in the workflow, source files, screenshots, or commits. If a secret is accidentally exposed, revoke or rotate it.

## 6. Run the report

1. Push or fork the project into your own GitHub repository.
2. Confirm the five repository secrets above are configured.
3. Open **Actions → YouTube daily Slack report → Run workflow** to test it manually.
4. Check the Slack channel for the report.

The workflow is scheduled for **00:15 UTC / 05:15 Pakistan time** each day. GitHub Actions scheduled runs can occasionally be delayed. A successful manual run is a good way to confirm the setup.

## Rate limits, quota, and missing data

- Temporary YouTube API throttling and backend errors are retried with a short exponential backoff.
- If the API reports exhausted quota, the workflow attempts to send a Slack warning and exits without sending a misleading all-zero analytics report.
- If the request still fails after retries, the workflow fails so the missed report is visible in GitHub Actions.
- If YouTube Analytics returns no daily rows for the seven-day lookback, the run fails instead of posting fabricated zero values. Check again later because analytics processing can be delayed.
- A successful run confirms the API request worked at that time; it does **not** reveal the exact quota remaining.

## Metrics and limitations

- Reports the latest available daily row in the previous seven complete UTC dates; it does not currently add the seven days together.
- Uses YouTube Analytics API, so the Google account must be authorized to access that channel's analytics.
- Public channel name and avatar are best-effort enhancements read from the public channel page. If YouTube changes its page markup or the page cannot be fetched, the report can continue without that branding.
- Revenue is not included by default.
- YouTube may delay or revise daily analytics.

import { createServer } from "node:http";
import { google } from "googleapis";

const clientId = process.env.YOUTUBE_CLIENT_ID;
const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in your local environment first.");
  process.exit(1);
}

const port = 3000;
const redirectUri = `http://localhost:${port}/oauth2callback`;
const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
const scopes = ["https://www.googleapis.com/auth/yt-analytics.readonly"];

const server = createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);
  if (url.pathname !== "/oauth2callback") {
    res.writeHead(404).end("Not found");
    return;
  }
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  if (error || !code) {
    res.writeHead(400, { "Content-Type": "text/plain" });
    res.end("Authorization was not completed. You can close this tab and check the terminal.");
    console.error("Google authorization failed:", error || "No authorization code returned.");
    server.close();
    process.exitCode = 1;
    return;
  }
  try {
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2>Authorization complete</h2><p>You can close this tab and return to your terminal.</p>");
    console.log("\nRefresh token (copy it directly into GitHub Actions secret YOUTUBE_REFRESH_TOKEN):\n");
    console.log(tokens.refresh_token || "Google did not return a refresh token. Revoke this app's access in your Google Account and run the generator again.");
    console.log("\nKeep this token private. Do not commit it to GitHub or send it in messages.");
    server.close();
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" }).end("Token exchange failed. Check the terminal.");
    console.error("Failed to exchange authorization code:", err.message);
    server.close();
    process.exitCode = 1;
  }
});

server.listen(port, "localhost", () => {
  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
  });
  console.log("Open this URL in your browser and sign in with the Google account that can access the channel's analytics:\n");
  console.log(authUrl);
  console.log(`\nWaiting for Google's redirect at ${redirectUri} ...`);
  console.log("If port 3000 is already in use, stop the other process and try again.");
});

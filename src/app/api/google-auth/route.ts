import { NextResponse } from "next/server";
import { google } from "googleapis";

export const runtime = "nodejs";

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

function getOAuth2(redirectUri: string) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET first");
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  /** Must match an “Authorized redirect URI” in Google Cloud Console for each deployed host (and localhost for dev). */
  const redirectUri = `${url.origin}/api/google-auth`;
  const code = url.searchParams.get("code");

  if (!code) {
    const oauth2 = getOAuth2(redirectUri);
    const authUrl = oauth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: SCOPES,
    });
    return NextResponse.redirect(authUrl);
  }

  try {
    const oauth2 = getOAuth2(redirectUri);
    const { tokens } = await oauth2.getToken(code);

    if (!tokens.refresh_token) {
      return new Response(
        `<html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;padding:20px">
          <h2 style="color:#DC2626">No refresh token received</h2>
          <p>Google only returns a refresh token on the <strong>first</strong> authorization.</p>
          <p>Go to <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>,
          remove access for this app, then try again.</p>
        </body></html>`,
        { headers: { "Content-Type": "text/html" } }
      );
    }

    return new Response(
      `<html><body style="font-family:sans-serif;max-width:600px;margin:40px auto;padding:20px">
        <h2 style="color:#16A34A">Success!</h2>
        <p>Add this line to your <code>.env.local</code> file:</p>
        <pre style="background:#f1f5f9;padding:16px;border-radius:8px;overflow-x:auto;font-size:14px;border:1px solid #e2e8f0">GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}</pre>
        <p>Then restart your dev server. You can delete this route after setup.</p>
        <p style="color:#64748B;font-size:13px">Calendar invites will be sent from whichever Google account you just authorized.</p>
      </body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Token exchange failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

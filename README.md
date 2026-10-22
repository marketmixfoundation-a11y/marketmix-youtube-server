# MarketMix YouTube Upload Server

Standalone Express backend for uploading property tour videos to YouTube via Google OAuth 2.0.

## Setup & Deployment on Render

1. Create a new **Web Service** on Render pointing to this standalone `youtube-server` directory.
2. Set Build Command: `npm install`
3. Set Start Command: `npm start`
4. Add Environment Variables in Render Dashboard:
   - `YOUTUBE_CLIENT_ID`
   - `YOUTUBE_CLIENT_SECRET`
   - `YOUTUBE_REDIRECT_URI` (`https://<your-render-service>.onrender.com/auth/youtube/callback`)
   - `YOUTUBE_REFRESH_TOKEN` (obtained after authenticating once via `/auth/youtube`)
   - `FIREBASE_PROJECT_ID` (`housing-database-e467b`)
   - `FIREBASE_SERVICE_ACCOUNT_JSON` (the Firebase Admin service-account JSON for the same project)
   - `CORS_ORIGINS` (comma-separated initial website origins; domains can also be managed in the real-estate Admin Dashboard)

## Manage Allowed Website Domains

Administrators can manage website origins from the real-estate Admin Dashboard under **API Domains**. The server verifies the Firebase ID token and checks the user's `role` in Firestore before allowing changes. Domain settings are stored in the Firestore document `settings/youtubeServer` and apply immediately.

The Render service must have `FIREBASE_SERVICE_ACCOUNT_JSON` set for this integration. Never place the service-account JSON in the website frontend or commit it to Git. Origins must be HTTPS URLs without paths, for example `https://example.com`.

## Seven-minute keep-alive

This service is intentionally separate from WAHA and from the `marketmix-comms` Worker.
The included `render.yaml` creates the dedicated `marketmix-youtube` Render Web Service.

After Render provides the service URL, configure the Cloudflare keep-alive Worker from the
backend workspace:

```bash
npx wrangler secret put YOUTUBE_URL --config cloudflare/marketmix-youtube-ping/wrangler.jsonc
npx wrangler deploy --config cloudflare/marketmix-youtube-ping/wrangler.jsonc
```

The keep-alive runs every seven minutes and requests `/health`. Render may still suspend free
services because of account limits or platform policy; this reduces idle spin-downs but does not
guarantee an always-on service.

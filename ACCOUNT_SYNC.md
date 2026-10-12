# Cross-device accounts and chat history

Account records and AI chat history are stored in Netlify Blobs, so the same
account can be used on multiple devices. Existing browser-only accounts are
copied to the shared store the first time they are signed in from the browser
that contains the old account.

## Netlify deployment

Set these environment variables in the Netlify site settings before deploying:

- `GOOGLE_CLIENT_ID`: the OAuth client ID configured for Google Identity
  Services (it must match the ID in `index.html`).
- `GEMINI_API_KEY`: required for AI responses.
- `GMAIL_USER` and `GMAIL_APP_PASSWORD`: required to email sign-in and
  registration codes.

Netlify Functions use the site's Blobs storage automatically. The session
signing key is generated once and stored privately in that shared store, so
`AUTH_SESSION_SECRET` is optional. To provide your own key instead, set it to a
random value of at least 32 bytes. Do not commit real keys or secrets.

## Vercel deployment

The root `api/` directory exposes the same API endpoints as Vercel Functions;
the shared handlers remain in `netlify/functions/`. `vercel.json` publishes
the repository root (including `AI.html`) as static assets while Vercel serves
the functions under `/api/`. Open `/AI.html` after deployment.

Set these Vercel environment variables before deploying, then redeploy so the
functions receive them:

- `GEMINI_API_KEY`: required for AI responses.
- `GMAIL_USER` and `GMAIL_APP_PASSWORD`: required to email sign-in and
  registration codes.
- `NETLIFY_SITE_ID` and `NETLIFY_AUTH_TOKEN`: required for persistent account,
  verification, and chat storage. Create a Netlify site with Blobs enabled and
  use that site's ID and a Netlify personal access token. Store both only in
  Vercel's encrypted environment-variable settings.
- `GOOGLE_CLIENT_ID`: required only if Google sign-in is used.
- `GEMINI_MODEL` and `AUTH_SESSION_SECRET`: optional overrides.

Do not deploy Vercel without the Blobs credentials if users need accounts or
saved chat history; the API returns a configuration error instead of silently
using temporary serverless storage.

## Local development

Copy `.env.example` to `.env`, then provide a local `GEMINI_API_KEY`,
`GMAIL_USER`, and `GMAIL_APP_PASSWORD`. `NETLIFY_SITE_ID` and
`NETLIFY_AUTH_TOKEN` are only needed for local access to Netlify Blobs.
Set `AUTH_SESSION_SECRET` only if you want to override the generated key.
Keep `.env` private. Start the API/static server with `python main.py`
(Node.js 20 or newer is also required); `npm start` starts the same server.

When using VS Code Live Server, keep the API server running too. It uses port
5509 by default and automatically selects the next port if that one is busy.
The AI page checks the local ports and connects to the running API server.
The Google OAuth client must allow the local site's origin in its authorized
JavaScript origins.

Chat history is merged with the account's saved history at sign-in and synced
after changes. The existing 30-chat limit remains in effect. A one-time
successful sign-in migrates a matching legacy email/password account from that
browser to the shared account store.

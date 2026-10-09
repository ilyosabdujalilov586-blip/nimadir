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

Netlify Functions use the site's Blobs storage automatically. The session
signing key is generated once and stored privately in that shared store, so
`AUTH_SESSION_SECRET` is optional. To provide your own key instead, set it to a
random value of at least 32 bytes. Do not commit real keys or secrets.

## Local development

Copy `.env.example` to `.env`, then provide a local `GOOGLE_CLIENT_ID`,
`NETLIFY_SITE_ID`, and `NETLIFY_AUTH_TOKEN`. Set `AUTH_SESSION_SECRET` only if
you want to override the generated key. Keep `.env` private. Start the
API/static server with `npm start`; when using VS Code Live Server, its API
requests connect to the same machine's server on port 5508.

Chat history is merged with the account's saved history at sign-in and synced
after changes. The existing 30-chat limit remains in effect. A one-time
successful sign-in migrates a matching legacy email/password account from that
browser to the shared account store.

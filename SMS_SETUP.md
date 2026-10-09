# SMS verification setup

Sign-up sends a six-digit verification code through Eskiz. Configure these
environment variables in Netlify under **Site configuration → Environment
variables** before deploying:

- `ESKIZ_EMAIL`: email address for the Eskiz API account.
- `ESKIZ_PASSWORD`: Eskiz API password.
- `ESKIZ_FROM`: sender ID approved for that account.
- `OTP_SIGNING_SECRET`: a private, randomly generated secret of at least 32
  characters, used to sign short-lived verification tokens.

Keep these values private. Do not put real credentials in GitHub or frontend
code. The same variables can be set in the local `.env` file to test with
`npm start`. Generate a signing secret with
`node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
The verification code expires after five minutes.

Phone numbers must use international E.164 format, for example
`+998901234567`. Spaces, parentheses, periods, and hyphens are also accepted
in the sign-up form.

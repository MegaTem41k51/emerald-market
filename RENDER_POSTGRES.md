# EMERALD Market — Render / PostgreSQL

## Required variables

- `BASE_URL` = `https://emerald-market-2.onrender.com`
- `SESSION_SECRET` = a long random secret
- `STEAM_API_KEY` = your Steam API key
- `DATABASE_URL` = Render Postgres **Internal Database URL**

## Email verification

The profile verification tab supports email confirmation by a 6-digit code.
Configure these variables on the Web Service if you want real email delivery:

- `EMAIL_HOST`
- `EMAIL_PORT` (usually `587`)
- `EMAIL_USER`
- `EMAIL_PASS`
- `EMAIL_FROM` (optional; defaults to EMAIL_USER)
- `EMAIL_SECURE` = `true` only when your SMTP provider requires implicit TLS (otherwise omit or use `false`)

The app creates the required email, API-key and session columns/tables automatically on startup. Existing PostgreSQL data is kept.

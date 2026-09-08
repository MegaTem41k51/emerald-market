# Email verification on Render Free

The project now supports sending verification emails through the Brevo HTTPS API. This avoids direct SMTP connections from Render Free.

## Render Environment Variables

Add:

```text
BREVO_API_KEY=xkeysib-...
EMAIL_FROM=your-verified-sender@example.com
EMAIL_FROM_NAME=EMERALD Market
```

`EMAIL_FROM` must be a sender verified in Brevo. The existing `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_USER`, and `EMAIL_PASS` variables can remain, but when `BREVO_API_KEY` is present the server uses Brevo first and does not use SMTP for verification emails.

## Brevo

1. Create a Brevo account.
2. Add/verify the sender email in the transactional email settings.
3. Create an API key.
4. Put the API key into Render as `BREVO_API_KEY`.
5. Put the verified sender address into `EMAIL_FROM`.
6. Redeploy the Render service.

The server calls `https://api.brevo.com/v3/smtp/email` over HTTPS. If `BREVO_API_KEY` is absent, the old SMTP path remains available for hosting where SMTP is allowed.

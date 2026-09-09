# Email verification on Render Free

This version sends verification emails through the Resend HTTPS API. It does not connect to SMTP ports, so it avoids Render Free SMTP restrictions.

## Render Environment Variables

Add these two variables:

```text
RESEND_API_KEY=re_...
EMAIL_FROM=your-verified-sender@example.com
```

Optional:

```text
EMAIL_FROM_NAME=EMERALD Market
```

The old SMTP variables (`EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_USER`, `EMAIL_PASS`) are no longer used by this email-verification code and can be removed from Render after deployment.

## Resend setup

1. Create a Resend account.
2. Create an API key and copy it once.
3. For testing, Resend provides the `onboarding@resend.dev` sender; this test sender is restricted to the account email.
4. For sending verification codes to arbitrary users, add and verify a domain in Resend, then use an address from that verified domain as `EMAIL_FROM`.
5. Put the API key into Render as `RESEND_API_KEY`.
6. Put the sender address into `EMAIL_FROM`.
7. Redeploy the Render service.

The server calls `https://api.resend.com/emails` over HTTPS.

# Member email delivery setup

The member portal now has server-side email confirmation and password recovery workflows. These features remain **inactive until a verified sender and provider credentials are configured** in the Railway production service.

## Required Railway web-service variables

Configure these in the Railway service **Ortakera Web** → Variables:

- `APP_BASE_URL=https://ortakera-web-production.up.railway.app` (or the verified custom HTTPS domain after it is configured)
- `RESEND_API_KEY` = the private API key from the organisation's Resend account
- `EMAIL_FROM` = a sender identity verified by Resend, for example `Ortakera <accounts@your-verified-domain.example>`

Never commit the API key or paste it into source files, issues, logs or chat. Use Railway's secret variable controls. The example sender above is illustrative and must not be used unless the domain is verified and controlled by the organisation.

The application sends through Resend's HTTPS API. Production requests use the fixed Resend API endpoint. The integration test can override it with `EMAIL_API_URL` only in `NODE_ENV=test`.

## Member journeys

- Registration attempts to send an email confirmation link. Account creation remains successful if email delivery is not configured; the response clearly reports that verification delivery is unavailable.
- Confirmation links are random one-time tokens, stored only as HMAC hashes, expire after 24 hours and cannot be replayed.
- A signed-in member can request another verification email. Requests are rate-limited.
- Password reset requests return the same public response whether or not the email exists, reducing account enumeration.
- Reset links are one-time, expire after one hour, and are stored as HMAC hashes.
- A successful password reset changes the scrypt password hash and revokes every active member session.
- The UI removes a consumed verification token from the address bar.

## Before enabling in production

1. Verify the sending domain and sender identity with Resend; publish the DNS records it supplies.
2. Configure the three variables above on **Ortakera Web**. Do not set `EMAIL_API_URL` in production.
3. Redeploy the web service and check Railway deployment logs for successful startup. No API key or email body should appear in logs.
4. Send a registration email to an organisation-controlled test inbox. Confirm sender, subject, link host, expiry text and delivery to inbox rather than spam.
5. Confirm the link once, then retry it and verify it is rejected.
6. Request a password reset for an organisation-controlled account, change the password, verify old sessions are rejected, sign in with the new password, and verify a replay is rejected.
7. Test unknown email addresses and rate limits. Keep the generic reset response.
8. Record provider delivery evidence and an owner for bounce/complaint monitoring.

## Important account policy

Email confirmation is currently recorded and displayed, but it is not yet enforced as a universal login or application gate. Do not claim all accounts are verified, and do not use the new field as proof of a person's legal identity, employer authority or recruitment licence. A separate policy decision and migration plan is required before enforcing verification for existing accounts.

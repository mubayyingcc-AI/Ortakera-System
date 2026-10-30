# Ortakera backend implementation status

## Runtime and deployment
- Node.js 20+
- PostgreSQL through Railway
- Node HTTP server; parameterized SQL through `pg`
- Five public interface languages: English, Turkish, Arabic (RTL), French and German

## Public endpoints
- `GET /health` — application/database readiness; returns 503 if database unavailable.
- `GET /api/v1/health` — API/database diagnostic.
- `POST /api/v1/enquiries` — validates and stores consented enquiries.

## Private staff endpoints
- `GET /admin` — private staff console entry page (noindex; not a security boundary).
- `POST /api/v1/admin/login` — verifies configured admin email and scrypt password hash; issues signed, HttpOnly, Secure, SameSite=Strict session cookie.
- `POST /api/v1/admin/logout` — clears the session cookie.
- `GET /api/v1/admin/session` — checks current session.
- `GET /api/v1/admin/enquiries` — lists persisted enquiries with status filter.
- `PATCH /api/v1/admin/enquiries/:id` — updates status inside a transaction and writes audit record.
- `GET /api/v1/admin/audit` — lists latest 100 admin audit events.

## Administrator setup (required)
Do not commit passwords or session secrets.
1. Generate a password hash locally from the repository root:
   `npm run admin:hash -- "your-long-unique-password"`
   Use a password of at least 12 characters. Copy the output only into Railway's `ADMIN_PASSWORD_HASH` variable. The hash format is `saltHex:derivedKeyHex`.
2. Generate a cryptographically random session secret of at least 32 characters, e.g. `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"`.
3. In Railway, set the web service variables:
   - `ADMIN_EMAIL` = the administrator's dedicated email address (lowercase).
   - `ADMIN_PASSWORD_HASH` = the generated hash.
   - `SESSION_SECRET` = the generated random secret.
4. Wait for the Railway deployment to complete. Visit `/admin` on the live domain and sign in.

The admin console remains closed until all three variables are set. Do not put the raw password into Railway, source files, GitHub issues, or chat. Rotate the password by generating a new hash and replacing the variable. Rotate sessions by replacing `SESSION_SECRET`.

## Data boundary and roadmap
Currently persisted:
- Enquiries and their workflow status.
- Administrative status-change audit events.

Not yet implemented:
- Staff invitations/multiple staff roles and permissions.
- Business organization accounts and structured requirements.
- Public opportunity publication and eligibility.
- Capability profiles, credential review and matching.
- Applications, delivery milestones and WorkProof evidence.
- Email notifications and user self-service account recovery.

Do not represent these future modules as live functionality. Enquiry status changes do not imply a job, contract, partnership, or verified outcome.

# Ortakera Opportunity Network

Multilingual Türkiye-first opportunity coordination platform.

## Runtime
- Node.js 20+
- PostgreSQL (Railway)
- Express-free Node HTTP server with parameterized SQL through `pg`
- Five interface languages: English, Turkish, Arabic (RTL), French and German

## Deploy
Railway service starts with `npm start`. Set these service variables:
- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `PGSSLMODE=require`
- `NODE_ENV=production`

The application creates the `enquiries` table and indexes at startup using an idempotent schema migration. The PostgreSQL service must be available before the web service can accept enquiries.

## API
- `GET /health` — app and database readiness; returns 503 when database is unavailable.
- `GET /api/v1/health` — API/database diagnostic.
- `POST /api/v1/enquiries` — validate consent and fields, then persist an enquiry and return a reference.

Example request:
```json
{
  "name": "Example Person",
  "email": "person@example.com",
  "organization": "Example Ltd",
  "interest": "business",
  "message": "We need multilingual customer support for our service.",
  "consent": true,
  "locale": "en"
}
```

Allowed interest values: `business`, `partnership`, `capability`, `other`.
The API applies basic per-IP submission throttling and input length limits. Do not log enquiry message content.

## Data boundary
This release stores enquiries only. It does not yet implement accounts, authentication, public opportunity listings, capability profiles, partner onboarding, application workflows, payments, hiring, immigration eligibility, or WorkProof evidence. Those must be implemented as separate verified modules before being represented as operational on the website.

The privacy notice is at `/privacy.html`. Review and replace the operational contact instructions and legal language with approved company details before public marketing.

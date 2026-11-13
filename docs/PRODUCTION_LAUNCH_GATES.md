# Production recovery and launch gates

Last reviewed: 2026-11-13

## Verified deployment baseline

- Railway project: `Ortakera`, production environment.
- Web service: `Ortakera Web`; latest deployment `bf01ca97-661d-4f99-809e-4d5dc7c88ba2`.
- Application commit: `d34f063214aae3e05248cf6636d8c6717c8003c0`.
- Deployment status: `SUCCESS`; web and Postgres services reported online with no Railway health warnings.
- Deployment pre-start suite: 18 passed, 0 failed.
- GitHub CI for the deployed commit: syntax/unit, browser-layout and PostgreSQL end-to-end all passed.
- PostgreSQL is a single replica with a 5,000 MB persistent volume mounted at `/var/lib/postgresql/data`.

These are deployment and test facts only. They do not establish backup recoverability, external browser acceptance, legal permission to conduct recruitment, or complete business operations.

## Database protection — action required in Railway dashboard

The Railway connector can confirm the Postgres volume exists, but it does not expose the Backups tab's schedule or PITR state. Do not assume either is enabled.

1. Open Railway project **Ortakera** and production environment.
2. Open service **Postgres** → **Backups**.
3. Enable Daily, Weekly and Monthly volume backup schedules. Railway's documented retention is 6 days for Daily, 27 days for Weekly and 89 days for Monthly.
4. For stronger recovery, enable PostgreSQL Point-in-Time Recovery (PITR) from the same Backups tab. Confirm Railway creates its archive bucket and reports archiving/base backup healthy. PITR activation redeploys the database service; schedule the restart during a low-traffic window and verify the web service reconnects afterwards.
5. Record the first successful backup timestamp and first restorable PITR timestamp. PITR does not cover time before its first base backup.
6. Perform a restore drill into a **separate restored Postgres service/database**. Verify key table counts and representative records before declaring recovery tested. Never test by overwriting the live production database.

Official references: [Railway volume backups](https://docs.railway.com/volumes/backups) and [Railway Postgres PITR](https://docs.railway.com/volumes/point-in-time-recovery).

Recommended additional layer: schedule encrypted logical exports (`pg_dump --format=custom --no-owner`) to storage outside this Railway project, with access restricted to the smallest necessary operator group. Test with `pg_restore --exit-on-error` into an isolated database. Do not put database URLs, passwords, archive credentials or dump contents in GitHub.

## Application launch blockers

- **Email verification and password recovery:** not implemented as a complete verified delivery workflow. Requires a chosen mail provider, verified sender/domain, secret configuration, expiring single-use tokens, rate limits, delivery logs and end-to-end tests. Do not claim accounts are email-verified today.
- **Complete translations:** the locale selector stores language preference and document direction, but page and form translations are partial. English and Turkish need full page-by-page QA; Arabic needs RTL layout and content review. Other advertised locales need full translation and QA before they are marketed as supported.
- **Recruitment compliance:** obtain Turkish legal advice on whether each listing, matching, introduction, screening and placement workflow requires İŞKUR authorisation. Keep regulated placement activity disabled until written advice and any required authorisation are in place. Do not charge candidates placement fees or promise permits, visas or jobs.
- **Privacy and data governance:** publish and review the final privacy notice, retention/deletion process, consent text, data-subject request handling, incident response and cross-border transfer arrangements before collecting live sensitive candidate information.
- **Operational moderation:** define employer/agency verification evidence, vacancy checks, JobProof review SLA, escalation, complaints and fraud response. JobProof is human review and must not be presented as automatic government verification.
- **Product completeness:** payments/subscriptions, email alerts, accommodation inventory, provider verification, booking, and local experience workflows are not verified live services. Do not advertise them as available.
- **Public acceptance:** run independent browser checks on the actual production domain (desktop and mobile), including registration, login, employer approval, enquiry submission, vacancy gating, admin logout/revocation and security headers. The CI browser tests are not a substitute for this external acceptance run.

## Release rule

A launch gate is closed only when its evidence is recorded: a merged commit and passing CI for code, a successful Railway deployment and health check for infrastructure, a backup/restore artifact for recovery, an end-to-end delivery trace for email, translation QA for languages, and written counsel/operational approval for regulated workflows. Do not call the entire platform production-ready while any mandatory gate above remains open.

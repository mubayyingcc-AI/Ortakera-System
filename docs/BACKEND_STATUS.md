# Ortakera backend implementation status

## Runtime
- Node.js 20+, PostgreSQL, Railway deployment target.
- Public enquiry API and signed-cookie administrator console retained.

## Employment data model
- candidate_profiles: structured candidate preferences linked to candidate enquiry reference.
- employer_requirements: structured hiring requirements linked to employer enquiry reference.
- vacancies: staff-created drafts with employer verification and legal-route review flags.
- job_applications: candidate applications linked to published vacancies and candidate records.

## Public endpoints
- GET /api/v1/jobs returns only vacancies marked published with both employer_verified and legal_route_checked true.
- POST /api/v1/jobs/:reference/apply validates the candidate registration reference and matching email; duplicate applications are rejected.
- POST /api/v1/enquiries stores general enquiries and structured candidate/employer records transactionally.

## Private staff endpoints
- GET /admin and /api/v1/admin/* require the configured administrator session.
- GET /api/v1/admin/candidates, employer-requirements, vacancies and applications provide pipeline views.
- POST /api/v1/admin/vacancies creates private vacancy drafts.
- PATCH /api/v1/admin/vacancies/:id updates status and employer/legal review flags; publication is blocked until both flags are true.

## Important limits
- Candidate registration is not a full account. Application identity currently uses the candidate reference and matching email; password accounts, profile editing and recovery are not implemented.
- Employer verification and legal-route flags are staff attestations; the platform does not independently verify company documents, work permit eligibility, lawyer advice or İŞKUR authorisation.
- Do not mark review flags true without underlying evidence and qualified review. A flag is not proof of government approval or a work permit.
- No automated candidate ranking, messaging, interview scheduling, notifications, document uploads or WorkProof onboarding evidence yet.
- International recruitment must be handled with qualified Turkish legal counsel and appropriately licensed recruitment partners.
- Never collect passport numbers, identity documents, bank details or sensitive personal data through the public forms.

## Administrator setup
Keep ADMIN_EMAIL, ADMIN_PASSWORD_HASH and SESSION_SECRET only in deployment secrets. Generate password hashes locally; never commit secrets.


## Recruitment partner workflow (added 2026-11-02)
- Public /employment page includes a recruitment partner application form.
- POST /api/v1/enquiries accepts recruitment_partner and transactionally creates the enquiry plus recruitment_partners record.
- Partner records include agency identity, licensing jurisdiction/status/reference, service regions, specialisms, candidate-fee policy, compliance declaration and review status.
- Private GET /api/v1/admin/recruitment-partners lists partner applications.
- Private PATCH /api/v1/admin/recruitment-partners/:id changes review status (received, due_diligence, approved, declined, suspended) and writes before/after audit evidence.
- Partner applications are not public endorsements. Approved status is an internal staff review state, not government accreditation or a substitute for licence verification.
- Do not represent an agent as authorised until original licence evidence and scope are checked with the relevant regulator and Turkish counsel.
- Candidate-fee policy is a declaration supplied by the applicant and must be verified during due diligence.

## Current build/deploy boundary
- Latest changes are committed to GitHub main. Railway currently reports that the workspace trial has expired; a new deployment cannot be triggered until the Railway account selects an available plan.
- The existing Railway deployment may still be serving the earlier commit. Do not describe the newly committed agency workflow as live until a deployment and runtime tests succeed.


## Quality checks
- `npm run check` runs Node syntax checks for the server, public website scripts, admin console and password-hash utility.
- GitHub Actions workflow `.github/workflows/checks.yml` runs on pushes and pull requests to `main` using Node 20.
- A green syntax workflow is necessary but not sufficient for production readiness; integration tests against PostgreSQL, browser tests, security review and deployment verification remain required.

## Recruitment partner review controls
- Staff console loads recruitment partner applications and exposes the review lifecycle controls.
- Vacancy review controls expose employer verification, legal-route review and publication status. Publishing remains blocked unless both verification booleans are true.


## Job / permit / appointment authenticity review
- Public employment page accepts structured job-offer, work-permit and consular-appointment review requests through the existing enquiry transaction.
- The `job_checks` table stores the claimed employer, optional agency, role, location, appointment date, claimed status, optional last four reference characters, and user-provided description. It deliberately does not collect passport numbers, national IDs, complete application references, credentials or document uploads.
- Private staff queue: GET `/api/v1/admin/job-checks`; staff PATCH `/api/v1/admin/job-checks/:id` records review status, findings, reviewer and timestamp, plus audit log.
- `official_source_confirmed` requires staff to record the official source and what was checked. This is an internal review record, not a government determination.
- Official sources linked on the page: Ministry e-İzin (`https://calismaizni.csgb.gov.tr/en/`) and official QR permit verification (`https://izinsorgula.csgb.gov.tr/`). Appointment authenticity may require confirmation directly with the relevant Turkish foreign mission or its officially designated appointment provider.
- No automatic government API integration exists. No uploaded documents are accepted by this initial workflow.


## Local/international opportunity subscriptions and paid verification intake (2026-11)
- Job subscriptions persist local, international or both market preferences in `job_subscriptions`. Email delivery, unsubscribe automation and consent lifecycle tooling remain to be implemented before outbound alerts are activated.
- Job checks store local/international applicant market and support employer/job offers, work permits, consular appointments, invitation letters and recruitment-agent due diligence.
- Public paid-review service categories are presented with fee disclosure before payment. This release does not collect payment or integrate a payment provider. Do not accept funds until provider integration, refund terms, service terms, tax/accounting and legal scope are approved.
- Job access, placement, work permits and visa approvals are never sold. No worker-paid recruitment or placement fee.

- Admin console now lists job-alert subscriptions at `/api/v1/admin/job-subscriptions` and paid verification interest is stored as an explicit flag for staff follow-up. Payment is not collected or automated; staff must provide a written quote and scope, and only later accept payment through an approved provider.

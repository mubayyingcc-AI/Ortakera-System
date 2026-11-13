# Ortakera Opportunity Network

<p align="center"><img src="public/images/ortakera-logo.webp" alt="Ortakera — Connect, Train, Work, Thrive. Your Opportunity in Türkiye" width="520"></p>

<p align="center"><strong>Connect · Train · Work · Thrive — Your Opportunity in Türkiye</strong></p>

A Türkiye-first opportunity network preview connecting employment pathways and future work-to-stay/local-service journeys.

## Language status

The public pages currently expose a language selector for English (default), Turkish, German, Russian, Arabic, Portuguese, Italian, Japanese, Korean and Simplified Chinese. French remains present in parts of the existing translation catalogue.

**Important:** selecting a language currently persists the preference and updates the document language/direction. It does not yet translate every page or every form. The main landing page has a partial translation catalogue; employment and privacy content remain substantially English. Do not describe this branch as fully multilingual until the complete translation catalogue and page-by-page QA are finished.

## Run locally

```bash
npm start
```

Open http://localhost:3000. The app uses Node's built-in HTTP server and PostgreSQL when DATABASE_URL is configured.

## Current preview scope

- Türkiye-inspired public website and opportunity lifecycle presentation.
- Employment interest flows for candidates, employers and recruitment partners.
- JobProof intake and human review states.
- Job alert interest registration.
- Vacancy and application backend foundations.
- Admin review foundations for submitted enquiries and checks.
- Ten-locale selector with preference persistence and Arabic document direction.
- Deployed production preview with PostgreSQL-backed member/employer workflows, administrator review, revocable administrator sessions and shared rate limiting. This is a limited operational preview, not yet a fully launch-cleared employment marketplace.



## Production deployment and launch gates

As of 2026-11-13, the production Railway environment has the web service and PostgreSQL service online. The latest deployed application commit is `d34f063214aae3e05248cf6636d8c6717c8003c0`. Its deployment pre-start suite passed 18/18 tests; the corresponding GitHub syntax/unit, browser-layout and PostgreSQL end-to-end checks passed. These checks establish the tested application baseline, not full commercial or regulatory readiness.

The production environment currently has a single PostgreSQL replica with a 5,000 MB persistent volume. Scheduled volume backups and point-in-time recovery have **not yet been independently verified as enabled**. Email verification, password recovery, complete page translations, payments, and full accommodation/provider workflows are not available as production services. See [Production recovery and launch gates](docs/PRODUCTION_LAUNCH_GATES.md) before accepting real candidate or employer traffic.

## Architecture roadmap — not yet live

See [TürkiyePass & Regional Opportunity Intelligence foundation](docs/ORTAKERA_TURKIYEPASS_ROI_FOUNDATION.md).

TürkiyePass, ROI, accommodation inventory, provider verification, StayProof, public local-experience listings, bookings, payments and regional intelligence are architecture proposals, not operational services in this preview. No real vacancy, provider, accommodation or partner should be assumed available unless it appears in a separately verified live workflow.

## Safety and product boundaries

Ortakera is not a government authority, licensed recruitment agency or immigration law firm. It does not issue permits or guarantee jobs, visas, accommodation or provider quality. Work eligibility must be determined through the competent authorities and qualified professionals. Never submit passport numbers, full permit references, OTPs, bank details or sensitive personal data through ordinary enquiry forms.
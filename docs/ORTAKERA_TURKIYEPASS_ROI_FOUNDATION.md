# Ortakera TürkiyePass & Regional Opportunity Intelligence (ROI)
## Foundation Architecture — Draft 1.0
**Status:** Architecture proposal; not yet implemented as production functionality  
**Product:** Ortakera Opportunity Network  
**Company:** Ortakera Systems  
**Tagline:** Turn local potential into verified opportunity.

## 1. Mission and product boundary
Ortakera connects people and organisations to genuine work opportunities, accommodation and local services in Türkiye. TürkiyePass is the user-facing journey and access layer. Regional Opportunity Intelligence (ROI) is the evidence-backed regional resource and coordination layer behind it.

TürkiyePass is an Ortakera product experience, not a government identity credential, passport, residence permit, visa, work permit, or official approval. Ortakera is not a government authority, licensed recruitment agency, immigration law firm, property certifier, or investment intermediary.

The system must never promise employment, work-permit eligibility, visa approval, property safety, provider quality, accommodation availability, or service outcomes without the relevant evidence and authority.

## 2. Product architecture
### 2.1 TürkiyePass — user journey layer
- **WorkPass:** candidate profile, genuine vacancy discovery when live inventory exists, employer context, JobProof status and next steps.
- **StayPass:** accommodation discovery and requests, with price/deposit/availability freshness and StayProof evidence.
- **Discover Türkiye:** regional experiences, heritage, local services and participating providers, only after listing and provider review.
- **LocalConnect:** language-aware access to local support and qualified providers.
- **Work & Live:** coordinate work location, accommodation, arrival and relevant services without giving legal advice.
- **Trust Record:** user-visible status and evidence trail; distinguish submitted, checked, confirmed by an official source, unable to verify, expired and disputed evidence.

TürkiyePass is a journey workspace, not a government document, legal status, single opaque score or token.

### 2.2 Regional Opportunity Intelligence (ROI)
ROI maintains a structured view of regional demand, resources, providers, capacity and evidenced service outcomes:
1. **Regional Resource Registry** — resources and listings with region, category, operator, service scope and lifecycle.
2. **Provider Evidence** — identity/authority evidence, review status, reviewer, timestamps, scope and expiry.
3. **Opportunity Matching** — deterministic fit rules and visible reasons; no black-box eligibility decisions.
4. **Journey Coordination** — connect work, stay, arrival and local services with explicit user consent.
5. **Local Value Trace** — record requests, bookings, provider participation and completion evidence.
6. **Regional Insights** — aggregate demand and capacity gaps from observed platform activity; no invented market signals or inferred sensitive traits.

## 3. Canonical domain model
Initial logical entities (not a claim that database tables already exist):
- **UserProfile:** user identity/contact references, preferred locale, region preferences and consent state.
- **Journey:** user-owned journey, purpose, current stage, selected services and next-action state.
- **JourneyStage:** typed stage, status, timestamps, responsible party and evidence references.
- **Opportunity:** a defined work or service need, scope, location, terms, capacity and publication state.
- **Employer:** organisation profile, representatives, evidence and review state.
- **Provider:** provider/operator profile, category, jurisdiction, capabilities and verification scope.
- **ResourceListing:** accommodation, experience, workspace or local-service offer, linked to provider and region.
- **AccommodationListing:** occupancy type, location, price components, deposit, rules, legal-authorisation evidence where applicable and availability timestamp.
- **ExperienceListing:** activity, location, operator, duration, price, capacity, restrictions and qualification evidence where relevant.
- **EvidenceItem:** evidence type, issuer/source, reference fingerprint, safe redacted metadata, submitted time, expiry and integrity metadata. Do not store passport numbers, full permit numbers, OTPs or bank credentials in ordinary forms.
- **VerificationReview:** reviewer, review scope, checks performed, source, outcome, limitations, timestamp and recheck date.
- **ProviderCapability:** declared and reviewed service capabilities with scope and expiry.
- **MatchExplanation:** rule version, matched criteria, unmet criteria and human-readable explanation.
- **ServiceRequest:** user intent, selected listing/provider, requested date/quantity and request state.
- **Booking:** accepted service terms, parties, price breakdown, cancellation terms, payment reference (never card data), and booking state.
- **OutcomeRecord:** completion/acceptance evidence, parties, timestamp, disputes and redress state.
- **RegionalDemandSignal:** observed, consent-compatible event aggregate with provenance, time window and sample size.
- **CapacitySnapshot:** provider-declared capacity, captured time, expiry and source.
- **ConsentRecord** and **AuditEvent:** purpose-specific consent and append-only operational audit events.

## 4. Trust and state machines
### 4.1 Provider/listing review
draft → submitted → evidence_review → approved_for_scope | needs_more_evidence | declined → suspended | expired

Approval is scoped to named checks and a validity period. Payment, listing subscription, uploaded photos or self-declaration never confer verified status. Provider approval does not automatically verify every listing.

### 4.2 Availability freshness
unknown → provider_declared → recently_confirmed → stale → unavailable

Every availability claim carries observed_at, source, and expires_at. Stale or unknown capacity must not be presented as available. User requests are not confirmed bookings.

### 4.3 JobProof
Retain the existing human-review model. Outcomes must distinguish received, due_diligence, official_source_confirmed, unable_to_verify, suspected_fraud, closed. “Official source confirmed” means the stated fact was checked against a named official source at a stated time; it is not a guarantee of future status or legal advice.

### 4.4 Booking and outcome
request_submitted → provider_response_pending → accepted | declined | expired → confirmed_only_after_terms_acceptance → in_service → completed | disputed | cancelled → closed

No payment capture, booking confirmation or availability promise until the provider, price, dates, cancellation terms and payment flow are implemented and tested.

### 4.5 Journey
planning → evidence_needed → ready_for_user_action → in_progress → completed | paused | withdrawn

“Ready” is a product workflow state, never an immigration or legal eligibility determination.

## 5. Matching rules
Use explicit, versioned rules. Examples:
- Job fit: role/sector, location, stated experience, language needs, employer status, vacancy freshness and human-reviewed eligibility caveats.
- Stay fit: location/commute preference, occupancy type, stated budget, dates, capacity freshness, price transparency and listing review scope.
- Experience fit: region, dates, language, accessibility requirements where voluntarily supplied, capacity freshness and provider qualification.
- Journey fit: temporal/location compatibility and explicit user preferences.

Every match must show why it matched, what was not checked, missing evidence, data freshness and the next safe action. Do not rank people by nationality, ethnicity, religion, health, or other sensitive traits. Do not infer work-permit eligibility. Do not use a single trust score.

## 6. Language and accessibility
Required locale order: English (default), Turkish, German, Russian, Arabic, Portuguese, Italian, Japanese, Korean, Simplified Chinese. French may remain an additional locale if maintained consistently.

Language selection must persist across pages and visits; localise actual content, forms, validation, success/error states and service terms. Arabic must use correct RTL layout. Legal and regulatory translations are convenience translations until reviewed by qualified counsel; the authoritative version must be identified. A language selector alone does not satisfy multilingual readiness.

## 7. Regional rollout and supply integrity
Begin with an Istanbul workflow pilot only when real employers, providers, evidence reviewers and service capacity have been onboarded. Expand to other regions based on verified supply, observed user demand, service quality and operational coverage—not tourism popularity alone. No region, provider, vacancy, accommodation or partnership is live until recorded and checked.

Potential later categories: geothermal/wellness services, rural agriculture and heritage experiences, workspace/long-stay infrastructure, cultural preservation and local business services. Health/wellness services require appropriately qualified and authorised operators; no medical outcome claims.

## 8. Commercial model and worker protection
Potential revenue, subject to legal and operational review:
- employer hiring workspace and coordination subscriptions;
- accommodation provider subscriptions and completed-booking commissions;
- corporate accommodation and relocation coordination;
- completed-experience commissions from qualified operators;
- optional visitor/remote-worker premium membership;
- partner workspace/service agreements with properly authorised agencies and qualified professionals.

No job-seeker recruitment or placement fee. Do not make access to essential job information conditional on payment. Any paid review must disclose scope, limits, price and timing before payment. No payment collection until a compliant provider and tested refund/dispute process exist.

## 9. Explicitly deferred
- Fractional property/agriculture tokenisation, investment products and tradable ownership interests.
- Blockchain or smart contracts without a demonstrated audit/interoperability need.
- Automated immigration, tax or legal advice.
- Government credential/visa/work-permit issuance or guarantees.
- Physical co-living hubs and owned accommodation inventory.
- Medical tourism claims or unqualified wellness services.
- AI-generated listings, synthetic availability, unverified market-demand estimates or automated verified badges.

## 10. Competitive substitute test
TürkiyePass/ROI must prove it does more than:
- a job board (vacancy discovery only);
- a hotel/OTA marketplace (room search and booking only);
- a local directory (provider names and contact details);
- a relocation agency (human coordination without reusable evidence);
- a CRM or case-management tool (records without user-facing cross-service journey);
- a generic AI chatbot (answers without verified source, state or accountability).

The differentiator is the connected, consent-based journey across work, stay and local services, with scoped evidence, freshness, transparent match explanations and auditable outcomes. This is a hypothesis to validate in product usage, not a claim of being first or uncopyable.

## 11. Implementation sequence and acceptance gates
**Gate A — Foundation:** domain model, state machines, permissions, consent, audit model, threat/privacy review.
**Gate B — Provider intake:** provider/listing submissions, evidence metadata, reviewer queue, scope-limited statuses, expiry and audit.
**Gate C — First joined journey:** connect existing candidate/employer/JobProof flows to a manually curated, evidence-reviewed accommodation request; no public listings without approved records.
**Gate D — Local service discovery:** add experiences/workspace/local services with category-specific evidence.
**Gate E — Transactions:** only after provider contracts, pricing, cancellations, refunds, disputes, payment security and applicable legal review.
**Gate F — Regional insights:** aggregate only real observed activity with minimum cohort/privacy safeguards.

Acceptance requires automated tests for state transitions, role access, audit completeness, expiry/freshness, consent, locale persistence, Arabic RTL, no stale availability claims, and no unauthorised payment/booking actions. End-to-end tests must use clearly labelled synthetic fixtures, never present them as live providers or real vacancies.

## 12. Current implementation truth
At the time of this document, the repository has an existing employment integration preview and backend tables for enquiries, candidate profiles, employer requirements, recruitment partners, JobProof checks, job subscriptions, vacancies and applications. The PR remains draft and unmerged. TürkiyePass, ROI, accommodation listings, experiences, provider verification workflow, booking, payment and regional intelligence are not implemented by this document. The existing ten-language selectors are not full translations: several pages and employment content remain English, and the README must not claim ten complete languages until verified.

## 13. Immediate next build
1. Correct the current preview branch language claims and capture the selected locale on form submission.
2. Add schema/migration design for Provider, ResourceListing, EvidenceItem, VerificationReview, ServiceRequest and AuditEvent with role boundaries and indexes.
3. Add an internal-only provider/evidence review queue before any public directory.
4. Add a manual, consented work-to-stay journey linking a candidate's job location to a provider request without asserting availability.
5. Add tests and preview artifacts; do not merge or deploy without explicit approval.

## 14. Official-source boundary for employment workflows
The Ministry of Labour and Social Security states that foreigners within the scope of the International Labour Force Law must obtain a work permit or exemption before starting work, and that applications proceed through the official e-İzin system. JobProof must therefore remain a guidance and evidence-review layer, direct users to official channels, and never decide legal eligibility or issue approvals. Official reference: https://www.csgb.gov.tr/en/frequently-asked-questions/directorate-general-of-international-labour-force/work-permit/ .
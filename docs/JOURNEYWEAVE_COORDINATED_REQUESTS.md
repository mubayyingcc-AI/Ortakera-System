# JourneyWeave — coordinated local opportunity requests

## Product boundary

JourneyWeave is Ortakera's local opportunity discovery and partner coordination layer. It borrows the distribution insight that hotels and trusted local organisations can introduce guests to local providers, but it does not copy another platform's brand, catalogue, wording, commercial claims or user interface.

The initial technical workflow is **multi-provider enquiry coordination**, not instant booking:
1. A provider account submits a local experience, service, transfer, workspace or stay-information offer.
2. Ortakera staff review the provider and the evidence for the offer's stated scope.
3. A public offer is eligible only when it is approved for scope and the provider reconfirmed availability within the previous 24 hours.
4. A customer selects up to eight eligible offers and submits one coordinated request with consent, a unique idempotency key, party size and optional date.
5. Each provider sees only the request items assigned to that provider and may record interest or unavailability. A provider response is not a reservation, acceptance, confirmed service or payment.
6. Staff can inspect the request and its provider responses.

## Terminology

- **JourneyWeave** — coordinated local discovery and request orchestration.
- **PartnerReach** — provider-facing workspace and attributed partner channel.
- **OfferProof Review** — human evidence review for an offer's defined scope.
- **Journey Request** — one customer request that can contain several independently handled provider items.
- **Provider Response** — an expression of interest or unavailability, not a booking.
- **Request Thread** — append-only event history for the request and provider responses.

## Backend and data model

The guarded PostgreSQL migration creates:
- `journey_requests`: request header, consent version, unique idempotency key, party size, date and status.
- `journey_request_items`: immutable offer snapshots, provider ownership, per-provider response state and optional indicative price.
- `journey_request_events`: append-only event records for request creation and provider responses.

Existing `local_partner_channels`, `local_offers` and `local_service_requests` remain the provider and referral foundation.

### API surface

- `POST /api/v1/discover/journey-requests` — submit a coordinated request (1–8 eligible offers).
- `GET /api/v1/partner/journey-requests` — list only request items assigned to the signed-in approved partner.
- `PATCH /api/v1/partner/journey-requests/:itemId/respond` — record a single provider response, with ownership check and row lock.
- `GET /api/v1/admin/journey-requests` — administrative overview behind the administrator session.
- Existing `GET /api/v1/discover` remains restricted to approved offers with availability confirmed in the previous 24 hours.

The customer form generates a UUID request key. Repeated submissions with the same key return the existing request instead of creating duplicate request records. Provider responses are one-way from `submitted`; conflicting second responses return HTTP 409. A provider can see only its own items.

## Legal and operational hold

`JOURNEYWEAVE_ENABLED` must remain `false` (or unset) in every production environment until written legal and operational approval. The server defaults to off. With the hold active, public discovery and enquiry endpoints, partner APIs and administrative review APIs return HTTP 423. The migration is skipped, so these JourneyWeave tables are not created in production while held.

Do not set the flag to true merely to test the website. Use an isolated non-production database and test environment. A future activation requires a documented decision and a controlled release.

## Explicitly not implemented / not authorised

- Booking, reservation, inventory lock or supplier acceptance.
- Payment collection, escrow, refunds, chargebacks, commissions, supplier payouts or tax calculation.
- Hotel PMS/concierge integrations, airline integrations, eSIM fulfilment, museum ticketing or third-party supplier APIs.
- Provider email/SMS/push notifications or customer transactional email for JourneyWeave.
- Automated identity, licence, insurance, property or government verification.
- Public accommodation inventory, accommodation brokerage or stay booking.
- Dynamic package pricing or guaranteed itinerary fulfilment.

No public service should describe a provider response as confirmed availability. Indicative prices are not binding quotes. A legal hold is not a substitute for legal advice, provider due diligence, consumer terms, privacy review, insurance and operational support.

## Release checklist

1. Obtain Turkish counsel's written classification of each activity, partner role, referral fee and customer journey.
2. Approve provider contracts, consumer terms, cancellation/refund handling, liability and complaint escalation.
3. Complete KVKK and cross-border data-transfer review, data retention/deletion and consent wording.
4. Verify provider identity, authority to supply each offer, insurance and relevant licences.
5. Define response SLAs, fraud handling, safety escalation, customer support and incident ownership.
6. Decide the lawful commercial model and payment/settlement provider; implement and test it separately.
7. Complete email/SMS delivery, monitoring, abuse controls, accessibility, translations and mobile acceptance tests.
8. Run isolated PostgreSQL migration, concurrency, idempotency, access-control and restore tests.
9. Obtain named product, legal and operational release approvals before changing the production flag.

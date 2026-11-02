# Ortakera Business Connect — Commercial Pilot Specification
## Product and operating blueprint
**Status:** Proposed pilot specification; not a live service, contract, price list or claim of operational capacity.
**Company:** Ortakera Systems
**Platform:** Ortakera Opportunity Network
**Offer:** Ortakera Business Connect
**Promise:** Multilingual business enquiry coordination with a clear record of what was received, who handled it and what happened next.

## 1. The first customer problem
A business receives enquiries from international customers in different languages and channels. Requests may be delayed, misunderstood, duplicated or lost between staff shifts. The pilot addresses the narrow operational gap between receiving an enquiry and handing it to the business owner or authorised staff member.

Do not claim this service increases bookings or revenue unless measured. Do not promise 24/7 coverage, a language, response time, booking completion or customer outcome until staffing and service tests support it.

## 2. Initial customer profile
Start with one operating location and a small team at an independent hotel, serviced accommodation operator or other business that already receives international customer enquiries. The business must nominate an accountable contact, approved communication channels, service hours, escalation rules and the staff authorised to confirm prices, availability and reservations.

Do not onboard an operator whose authority, contact details or right to offer the service cannot be reasonably checked.

## 3. Pilot scope
### Included — only after legal approval and operational readiness
- Capture customer enquiries through an agreed business-controlled channel or a defined forwarding process.
- Record enquiry category, preferred language, received time, requested dates/service, assigned owner and status.
- Prepare or send approved factual responses using business-supplied information and pre-approved templates.
- Route questions about price, availability, special requests, refunds, complaints or commitments to the business's authorised staff.
- Track handover, response and closure timestamps.
- Produce a weekly operational summary: volume, categories, language requested, status, response-time distribution and unresolved items.

### Excluded from the first pilot
- Taking deposits, card details or customer money.
- Confirming, changing or cancelling reservations on behalf of a business unless counsel specifically approves the agency and contracting model.
- Setting prices, guaranteeing availability, making refunds or accepting contractual commitments.
- Recruitment, candidate screening, job matching, work-permit or immigration advice.
- Accommodation brokerage, paid listing commissions or tourism package sales.
- Medical, legal, financial or other regulated advice.
- Scraping private accounts, using personal messaging accounts without authorisation, or sending unsolicited marketing.
- Automated translation of legally significant terms without human review.

## 4. Workflow and evidence trail
1. **Business onboarding:** verify business identity and representative authority; record approved channels, operating hours, supported languages, escalation contacts and service scope.
2. **Configuration:** agree a written service schedule, response targets, data roles, retention, access and approved response templates.
3. **Enquiry received:** assign a unique internal reference; record source, received time, language preference and minimum necessary enquiry details.
4. **Triage:** classify as information request, date/availability request, price request, change/cancellation, complaint or other.
5. **Response preparation:** use only current business-approved facts. If information is missing or stale, route to the business rather than guessing.
6. **Handover:** log the receiving staff member, timestamp, pending question and responsibility.
7. **Closure:** record the outcome reported by the business; do not infer that an enquiry became a booking.
8. **Review:** weekly report, unresolved cases, corrections, complaints and agreed service improvements.

## 5. Minimum record model (logical; not a claim of existing tables)
- BusinessAccount: legal/trading name, jurisdiction, business contact, authority evidence status, review scope and timestamp.
- ServiceAgreement: parties, approved service scope, start/end, service hours, response target, fee, payment terms, data roles and signed-document reference.
- ChannelAuthorization: channel identifier, account owner, permitted access method, authorising representative, scope and expiry.
- EnquiryCase: internal reference, business, source channel, received time, locale, category, minimal message summary, status and assigned operator.
- CaseEvent: append-only event type, actor, timestamp, previous/new status and safe event metadata.
- ApprovedBusinessFact: fact, source owner, approved-by, effective-from, expiry and version.
- Handover: recipient, reason, timestamp, acknowledgement and next action.
- Outcome: reported status, reported-by, timestamp, evidence reference and dispute flag.
- Complaint: issue, severity, owner, response, resolution and escalation history.
- DataRequest: access/correction/deletion request, identity-check status, owner and completion evidence.

Do not store payment card data, passport data, permit numbers, passwords, OTPs or unnecessary sensitive personal data. Keep message content only where required for the agreed service, with a defined retention schedule and deletion process.

## 6. Service states
received → triaged → response_drafted → awaiting_business → handed_over → awaiting_customer | resolved | withdrawn
A case may be reopened with a new event; do not erase the prior event history. A status is not proof of a reservation, sale or customer satisfaction.

## 7. Pilot commercial structure
Use a fixed-scope paid pilot only after counsel approves the contracting and service model. The agreement should define:
- named business and authorised representative;
- exact channels and service hours;
- supported languages actually staffed;
- case volume or workload cap;
- response target and exclusions;
- who can approve prices, availability and contractual commitments;
- fee, invoice currency, tax treatment and payment schedule;
- data-controller/processor roles, permitted subprocessors and cross-border transfer safeguards;
- retention, deletion, security, incident notification and access controls;
- complaint handling, service credits/refunds, termination and handover;
- no guarantee of bookings, revenue, customer conversion or legal compliance.

Do not publish a price until delivery cost, staffing, tax treatment and service scope are confirmed. Pilot success should be assessed from operational evidence, not testimonials alone.

## 8. Pilot acceptance measures
Capture a baseline where the customer can supply it. During the pilot report:
- enquiries received and validly captured;
- percentage assigned an owner;
- median and 90th-percentile time to first human response;
- unresolved and overdue cases;
- handover acknowledgement rate;
- corrections caused by inaccurate or stale business facts;
- complaints, privacy incidents and unauthorised commitments;
- delivery hours and direct cost per case;
- customer renewal or paid continuation decision.

Targets must be agreed before the pilot and must not be invented after observing results.

## 9. Legal review questions
Ask Turkish counsel to classify the exact service against employment agency, tourism/accommodation intermediation, consumer, e-commerce, commercial electronic message, data protection, cross-border transfer, tax and invoicing rules. Ask whether a Turkish entity, permit, registration, authorisation, local office or licensed partner is required before marketing, contracting, accessing customer channels or delivering the pilot.

Ask counsel to review the actual agreement, privacy notice, data-processing terms, channel authorisation, approved templates and complaint/refund policy. If any part of the workflow is regulated, remove or defer that part until the correct authorisation is in place.

## 10. Build sequence and release gates
**B0 — Definition:** counsel-approved service boundary, customer profile, contract scope and operational owner.
**B1 — Intake:** secure case creation, consent/notice, locale, reference and validation.
**B2 — Operations:** authenticated staff access, role-based assignment, status transitions, append-only audit events and escalation.
**B3 — Business facts:** versioned, expiring facts and approval before customer-facing use.
**B4 — Reporting:** case counts, response-time measures and export with access control.
**B5 — Pilot:** one real business, signed agreement, trained operators, baseline and acceptance review.
**B6 — Scale:** only after repeat paid demand, positive unit economics, legal clearance and incident-free operational evidence.

No production deployment or customer-data migration is authorised by this document. The existing product branch remains a preview until separately tested and approved.

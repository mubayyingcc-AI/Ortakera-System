import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const port = 3400 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;
const adminEmail = 'e2e-admin@ortakera.test';
const adminPassword = 'Test-only-admin-password-2026!';
const memberEmail = `member-${randomBytes(6).toString('hex')}@ortakera.test`;
const partnerEmail = `partner-${randomBytes(6).toString('hex')}@ortakera.test`;
const sessionSecret = randomBytes(48).toString('hex');
let server;
let emailServer;
const capturedEmails = [];

async function passwordHash(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
async function request(path, { method = 'GET', body, cookie, origin = base, clientIp } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (clientIp) headers['x-real-ip'] = clientIp;
  if (origin) headers.origin = origin;
  const response = await fetch(base + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = {};
  try { data = await response.json(); } catch {}
  const rawCookie = response.headers.get('set-cookie') || '';
  return { status: response.status, data, cookie: rawCookie ? rawCookie.split(';')[0] : '' };
}
async function waitForHealth(child) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Application exited before health became ready');
    try {
      const response = await fetch(base + '/health');
      if (response.status === 200) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('Application did not become healthy within 30 seconds');
}

test('end-to-end PostgreSQL-backed member, employer, enquiry and administrator journeys', async t => {
  const adminHash = await passwordHash(adminPassword);
  emailServer = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk.toString();
    try { capturedEmails.push(JSON.parse(raw)); } catch {}
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'test-email-' + capturedEmails.length }));
  });
  emailServer.listen(0, '127.0.0.1');
  await once(emailServer, 'listening');
  const emailPort = emailServer.address().port;
  server = spawn(process.execPath, ['server.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      SESSION_SECRET: sessionSecret,
      ADMIN_EMAIL: adminEmail,
      ADMIN_PASSWORD_HASH: adminHash,
      NODE_ENV: 'test',
      APP_BASE_URL: base,
      RESEND_API_KEY: 'test-key',
      EMAIL_FROM: 'Ortakera Test <test@ortakera.test>',
      EMAIL_API_URL: 'http://127.0.0.1:' + emailPort
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  server.stdout.on('data', chunk => { logs += chunk.toString(); });
  server.stderr.on('data', chunk => { logs += chunk.toString(); });
  t.after(async () => {
    if (server && server.exitCode === null) {
      server.kill('SIGTERM');
      await Promise.race([once(server, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]);
    }
    if (server && server.exitCode === null) server.kill('SIGKILL');
    if (emailServer) await new Promise(resolve => emailServer.close(resolve));
  });

  await waitForHealth(server);
  const migrationDeadline = Date.now() + 30000;
  while (!logs.includes('Database schema ready') && Date.now() < migrationDeadline) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(logs.includes('Database schema ready'), 'database migrations must complete');
  const health = await request('/api/v1/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.database, 'connected');
  const publicHealth = await fetch(base + '/health');
  assert.equal(publicHealth.headers.get('x-frame-options'), 'DENY');
  assert.equal(publicHealth.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(publicHealth.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');

  const rejectedMissingOrigin = await request('/api/v1/member/register', { method: 'POST', origin: null, body: {
    full_name: 'Blocked Origin', email: 'blocked-origin@ortakera.test', password: 'Test-only-member-password-2026!'
  } });
  assert.equal(rejectedMissingOrigin.status, 403);
  const rejectedCrossOrigin = await request('/api/v1/member/register', { method: 'POST', origin: 'https://attacker.example', body: {
    full_name: 'Blocked Origin', email: 'blocked-origin-2@ortakera.test', password: 'Test-only-member-password-2026!'
  } });
  assert.equal(rejectedCrossOrigin.status, 403);

  const anonymous = await request('/api/v1/member/me');
  assert.equal(anonymous.status, 401);

  const invalidRegistration = await request('/api/v1/member/register', {
    method: 'POST',
    body: { full_name: 'Test Member', email: memberEmail, password: 'short' }
  });
  assert.equal(invalidRegistration.status, 422);

  const registered = await request('/api/v1/member/register', {
    method: 'POST',
    body: { full_name: 'E2E Member', email: memberEmail, password: 'Test-only-member-password-2026!' }
  });
  assert.equal(registered.status, 201);
  assert.equal(registered.data.account.plan, 'free');
  assert.equal(registered.data.account.account_status, 'active');
  assert.equal(registered.data.account.email_verified, false);
  assert.equal(registered.data.email_verification, 'sent');
  assert.equal(capturedEmails.length, 1, 'registration must send a verification email');
  const verificationLink = capturedEmails[0].html.match(/href="([^"]+)"/)?.[1];
  assert.ok(verificationLink, 'verification email must contain a confirmation link');
  const verificationToken = new URL(verificationLink).searchParams.get('verify');
  assert.ok(verificationToken);
  const verified = await request('/api/v1/member/verify-email/confirm', { method: 'POST', body: { token: verificationToken } });
  assert.equal(verified.status, 200);
  const replayedVerification = await request('/api/v1/member/verify-email/confirm', { method: 'POST', body: { token: verificationToken } });
  assert.equal(replayedVerification.status, 400, 'verification links must be single use');

  const duplicate = await request('/api/v1/member/register', {
    method: 'POST',
    body: { full_name: 'E2E Member', email: memberEmail, password: 'Test-only-member-password-2026!' }
  });
  assert.equal(duplicate.status, 409);

  const badLogin = await request('/api/v1/member/login', {
    method: 'POST',
    body: { email: memberEmail, password: 'incorrect-password-2026' }
  });
  assert.equal(badLogin.status, 401);

  const login = await request('/api/v1/member/login', {
    method: 'POST',
    body: { email: memberEmail, password: 'Test-only-member-password-2026!' }
  });
  assert.equal(login.status, 200);
  assert.ok(login.cookie.startsWith('ortakera_member='));
  let memberCookie = login.cookie;

  const me = await request('/api/v1/member/me', { cookie: memberCookie });
  assert.equal(me.status, 200);
  assert.equal(me.data.account.email, memberEmail);
  const secondSession = await request('/api/v1/member/login', { method: 'POST', body: { email: memberEmail, password: 'Test-only-member-password-2026!' } });
  assert.equal(secondSession.status, 200);
  const revokeAll = await request('/api/v1/member/logout-all', { method: 'POST', cookie: memberCookie });
  assert.equal(revokeAll.status, 200);
  assert.equal((await request('/api/v1/member/me', { cookie: memberCookie })).status, 401);
  assert.equal((await request('/api/v1/member/me', { cookie: secondSession.cookie })).status, 401);
  const afterRevocation = await request('/api/v1/member/login', { method: 'POST', body: { email: memberEmail, password: 'Test-only-member-password-2026!' } });
  assert.equal(afterRevocation.status, 200);
  memberCookie = afterRevocation.cookie;

  const profile = await request('/api/v1/member/profile', {
    method: 'PATCH',
    cookie: memberCookie,
    body: { country: 'Nigeria', city: 'Lagos', preferred_sectors: 'Hospitality', website: 'https://example.test' }
  });
  assert.equal(profile.status, 200);
  assert.equal(profile.data.profile.city, 'Lagos');

  const unsafeProfile = await request('/api/v1/member/profile', {
    method: 'PATCH', cookie: memberCookie,
    body: { website: 'http://not-secure.example' }
  });
  assert.equal(unsafeProfile.status, 422);

  const jobs = await request('/api/v1/member/jobs', { cookie: memberCookie });
  assert.equal(jobs.status, 200);
  assert.deepEqual(jobs.data.items, []);

  const partner = await request('/api/v1/member/register', {
    method: 'POST',
    body: { full_name: 'E2E Partner', email: partnerEmail, password: 'Test-only-partner-password-2026!', account_type: 'employer', organization: 'E2E Hospitality Ltd' }
  });
  assert.equal(partner.status, 201);
  assert.equal(partner.data.account.account_status, 'pending_review');
  const partnerLogin = await request('/api/v1/member/login', {
    method: 'POST',
    body: { email: partnerEmail, password: 'Test-only-partner-password-2026!' }
  });
  assert.equal(partnerLogin.status, 200);
  const blockedHiring = await request('/api/v1/employer/vacancies', { method: 'POST', cookie: partnerLogin.cookie, body: {
    title: 'Guest Services Associate', sector: 'Hospitality', location: 'Istanbul',
    description: 'A detailed test role with duties, hours, contract and compensation details.',
    headcount: 1, employment_type: 'Full-time', work_authorisation: 'not_assessed'
  } });
  assert.equal(blockedHiring.status, 403);

  const invalidEnquiry = await request('/api/v1/enquiries', { method: 'POST', body: {
    name: 'E2E Candidate', email: `candidate-${randomBytes(4).toString('hex')}@ortakera.test`,
    interest: 'employment_candidate', message: 'Candidate profile for integration test',
    consent: false, fields: { location: 'Lagos', sector: 'Hospitality', role: 'Guest Services', experience: 'Mid', eligibility: 'Needs review' }
  } });
  assert.equal(invalidEnquiry.status, 422);

  const candidateEmail = `candidate-${randomBytes(4).toString('hex')}@ortakera.test`;
  const candidate = await request('/api/v1/enquiries', { method: 'POST', body: {
    name: 'E2E Candidate', email: candidateEmail, locale: 'en',
    interest: 'employment_candidate', message: 'Seeking hospitality opportunities in Türkiye.',
    consent: true, fields: { location: 'Lagos, Nigeria', sector: 'Hospitality', role: 'Guest Services', experience: 'Mid-level', languages: 'English', eligibility: 'Needs employer sponsorship' }
  } });
  assert.equal(candidate.status, 201);
  assert.match(candidate.data.reference, /^ORT-\d{4}-[A-F0-9]{8}$/);

  const unauthorisedAdmin = await request('/api/v1/admin/enquiries');
  assert.equal(unauthorisedAdmin.status, 401);
  const adminLogin = await request('/api/v1/admin/login', {
    method: 'POST', body: { email: adminEmail, password: adminPassword }
  });
  assert.equal(adminLogin.status, 200);
  assert.ok(adminLogin.cookie.startsWith('ortakera_admin='));
  const membership = await request('/api/v1/admin/membership-requests', { cookie: adminLogin.cookie });
  assert.equal(membership.status, 200);
  const employerRequest = membership.data.items.find(item => item.email === partnerEmail && item.request_type === 'employer');
  assert.ok(employerRequest, 'employer application must be visible to staff');
  const approvedEmployer = await request('/api/v1/admin/membership-requests/' + employerRequest.id, {
    method: 'PATCH', cookie: adminLogin.cookie,
    body: { request_status: 'approved', evidence_reference: 'E2E-DUE-DILIGENCE-001', verification_note: 'Test-only evidence review; not a real approval.' }
  });
  assert.equal(approvedEmployer.status, 200);
  const approvedEmployerMe = await request('/api/v1/member/me', { cookie: partnerLogin.cookie });
  assert.equal(approvedEmployerMe.status, 200);
  assert.equal(approvedEmployerMe.data.account.account_status, 'active');

  const employerVacancy = await request('/api/v1/employer/vacancies', { method: 'POST', cookie: partnerLogin.cookie, body: {
    title: 'Guest Services Associate', sector: 'Hospitality', location: 'Istanbul',
    description: 'A test-only role with duties, working hours, contract type and compensation details for the integration workflow.',
    gross_pay_range: 'Test only', headcount: 1, employment_type: 'Full-time', work_authorisation: 'not_assessed'
  } });
  assert.equal(employerVacancy.status, 201);
  assert.equal(employerVacancy.data.item.status, 'under_review');

  const prePublicationJobs = await request('/api/v1/member/jobs', { cookie: memberCookie });
  assert.equal(prePublicationJobs.status, 200);
  assert.equal(prePublicationJobs.data.items.length, 0, 'unverified employer vacancy must remain private');

  const adminVacancies = await request('/api/v1/admin/vacancies', { cookie: adminLogin.cookie });
  assert.equal(adminVacancies.status, 200);
  const createdVacancy = adminVacancies.data.items.find(item => item.reference_code === employerVacancy.data.item.reference_code);
  assert.ok(createdVacancy);
  const published = await request('/api/v1/admin/vacancies/' + createdVacancy.id, {
    method: 'PATCH', cookie: adminLogin.cookie,
    body: { status: 'published', employer_verified: true, legal_route_checked: true }
  });
  assert.equal(published.status, 200);

  const publishedJobs = await request('/api/v1/member/jobs', { cookie: memberCookie });
  assert.equal(publishedJobs.status, 200);
  assert.ok(publishedJobs.data.items.some(item => item.reference_code === createdVacancy.reference_code));
  const saved = await request('/api/v1/member/saved-jobs', {
    method: 'POST', cookie: memberCookie, body: { reference_code: createdVacancy.reference_code }
  });
  assert.equal(saved.status, 200);
  const application = await request('/api/v1/member/applications', {
    method: 'POST', cookie: memberCookie, body: { reference_code: createdVacancy.reference_code }
  });
  assert.equal(application.status, 201);
  const memberApplications = await request('/api/v1/member/applications', { cookie: memberCookie });
  assert.ok(memberApplications.data.items.some(item => item.id === application.data.application.id));

  const employerApplications = await request('/api/v1/employer/applications', { cookie: partnerLogin.cookie });
  assert.equal(employerApplications.status, 200);
  const ownApplication = employerApplications.data.items.find(item => item.id === application.data.application.id);
  assert.ok(ownApplication, 'employer must see the application for its own vacancy');
  const statusUpdate = await request('/api/v1/employer/applications/' + ownApplication.id, {
    method: 'PATCH', cookie: partnerLogin.cookie, body: { status: 'shortlisted' }
  });
  assert.equal(statusUpdate.status, 200);
  assert.equal(Object.hasOwn(ownApplication, 'account_id'), false, 'employer response must not expose internal candidate account identifiers');
  const unrelatedApplication = await request('/api/v1/employer/applications/' + randomBytes(16).toString('hex').replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'), {
    method: 'PATCH', cookie: partnerLogin.cookie, body: { status: 'shortlisted' }
  });
  assert.equal(unrelatedApplication.status, 404, 'employer cannot update an application outside its own vacancies');
  const updatedApplications = await request('/api/v1/member/applications', { cookie: memberCookie });
  assert.equal(updatedApplications.data.items.find(item => item.id === ownApplication.id).status, 'shortlisted');

  const enquiries = await request('/api/v1/admin/enquiries', { cookie: adminLogin.cookie });
  assert.equal(enquiries.status, 200);
  assert.ok(enquiries.data.items.some(item => item.reference_code === candidate.data.reference));
  const candidates = await request('/api/v1/admin/candidates', { cookie: adminLogin.cookie });
  assert.equal(candidates.status, 200);
  assert.ok(candidates.data.items.some(item => item.reference_code === candidate.data.reference));

  const audit = await request('/api/v1/admin/audit', { cookie: adminLogin.cookie });
  assert.equal(audit.status, 200);
  assert.ok(Array.isArray(audit.data.items));

  const secondAdminLogin = await request('/api/v1/admin/login', {
    method: 'POST', body: { email: adminEmail, password: adminPassword }
  });
  assert.equal(secondAdminLogin.status, 200);
  const adminSession = await request('/api/v1/admin/session', { cookie: secondAdminLogin.cookie });
  assert.equal(adminSession.status, 200);
  const adminLogout = await request('/api/v1/admin/logout', { method: 'POST', cookie: secondAdminLogin.cookie });
  assert.equal(adminLogout.status, 200);
  const revokedAdminSession = await request('/api/v1/admin/session', { cookie: secondAdminLogin.cookie });
  assert.equal(revokedAdminSession.status, 401, 'administrator logout must revoke the server-side session');
  const firstAdminSession = await request('/api/v1/admin/session', { cookie: adminLogin.cookie });
  assert.equal(firstAdminSession.status, 200, 'logging out one administrator session must not revoke another active session');
});

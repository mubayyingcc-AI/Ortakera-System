import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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

async function passwordHash(password) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}
async function request(path, { method = 'GET', body, cookie, origin = base } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
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
  server = spawn(process.execPath, ['server.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      SESSION_SECRET: sessionSecret,
      ADMIN_EMAIL: adminEmail,
      ADMIN_PASSWORD_HASH: adminHash,
      NODE_ENV: 'test'
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
  });

  await waitForHealth(server);
  const migrationDeadline = Date.now() + 30000;
  while (!logs.includes('Database schema ready') && Date.now() < migrationDeadline) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(logs.includes('Database schema ready'), 'database migrations must complete');
  const health = await request('/api/v1/health');
  assert.equal(health.status, 200);
  assert.equal(health.data.database, 'connected');

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
  const memberCookie = login.cookie;

  const me = await request('/api/v1/member/me', { cookie: memberCookie });
  assert.equal(me.status, 200);
  assert.equal(me.data.account.email, memberEmail);

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

  const logout = await request('/api/v1/member/logout', { method: 'POST', cookie: memberCookie });
  assert.equal(logout.status, 200);
  assert.equal((await request('/api/v1/member/me', { cookie: memberCookie })).status, 401);

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
  const enquiries = await request('/api/v1/admin/enquiries', { cookie: adminLogin.cookie });
  assert.equal(enquiries.status, 200);
  assert.ok(enquiries.data.items.some(item => item.reference_code === candidate.data.reference));
  const candidates = await request('/api/v1/admin/candidates', { cookie: adminLogin.cookie });
  assert.equal(candidates.status, 200);
  assert.ok(candidates.data.items.some(item => item.reference_code === candidate.data.reference));

  const audit = await request('/api/v1/admin/audit', { cookie: adminLogin.cookie });
  assert.equal(audit.status, 200);
  assert.ok(Array.isArray(audit.data.items));
});

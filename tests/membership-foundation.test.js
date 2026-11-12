import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('member portal is served and linked from public pages', async () => {
 const [server,home,jobs,account,client]=await Promise.all([read('server.js'),read('public/index.html'),read('public/employment.html'),read('public/account.html'),read('public/account.js')]);
 assert.ok(server.includes("pathname === '/account'"));
 assert.ok(home.includes('href="/account"'));
 assert.ok(jobs.includes('href="/account"'));
 assert.ok(account.includes('id="loginForm"')&&account.includes('id="registerForm"')&&account.includes('id="partnerForm"'));
 assert.ok(client.includes('/api/v1/member/login')&&client.includes('/api/v1/member/register'));
});

test('member API supports free, agent and partner registration without self-assigning paid status', async () => {
 const server=await read('server.js');
 for(const route of ['/api/v1/member/register','/api/v1/member/login','/api/v1/member/logout','/api/v1/member/me','/api/v1/member/requests'])assert.ok(server.includes(route));
 assert.ok(server.includes("account_type IN ('member','agent','partner','employer')"));
 assert.ok(server.includes("['member','agent','partner','employer'].includes(type)"));
 assert.ok(server.includes("type==='member'?'active':'pending_review'"));
 assert.ok(server.includes("plan TEXT NOT NULL DEFAULT 'free'"));
 assert.ok(server.includes("a.plan==='subscribed'"));
 assert.ok(server.includes("Subscribed access activates only after payment verification"));
});

test('member sessions are hashed at rest and passwords use scrypt', async () => {
 const server=await read('server.js');
 assert.ok(server.includes('async function memberPassword'));
 assert.ok(server.includes('await scrypt(password,salt,64)'));
 assert.ok(server.includes('token_hash TEXT NOT NULL UNIQUE'));
 assert.ok(server.includes("createHmac('sha256',sessionSecret()).update(token).digest('hex')"));
 assert.ok(server.includes('HttpOnly; Secure; SameSite=Lax'));
});

test('admin review controls agent, partner and subscription entitlements', async () => {
 const [server,admin,adminClient]=await Promise.all([read('server.js'),read('public/admin.html'),read('public/admin.js')]);
 assert.ok(server.includes('/api/v1/admin/membership-requests'));
 assert.ok(server.includes("SET plan='subscribed'"));
 assert.ok(server.includes("SET account_status='active'"));
 assert.ok(admin.includes('id="loadMembership"'));
 assert.ok(adminClient.includes('loadMembershipRequests'));
});

test('member profile is account-scoped, allow-listed and connected to the portal', async () => {
 const [server,html,client]=await Promise.all([read('server.js'),read('public/account.html'),read('public/account.js')]);
 assert.ok(server.includes('CREATE TABLE IF NOT EXISTS member_profiles'));
 assert.ok(server.includes("url.pathname==='/api/v1/member/profile'"));
 assert.ok(server.includes("const allowed=['country','city','bio','preferred_sectors','preferred_roles','languages','website','operating_regions','specialisms','licensing_status']"));
 assert.ok(server.includes('ON CONFLICT(account_id) DO UPDATE'));
 assert.ok(html.includes('id="profileForm"'));
 assert.ok(client.includes("api('/api/v1/member/profile'"));
});

test('member workspace lists only verified published vacancies and tracks saved jobs and applications', async () => {
 const [server,html,client]=await Promise.all([read('server.js'),read('public/account.html'),read('public/account.js')]);
 assert.ok(server.includes('CREATE TABLE IF NOT EXISTS member_saved_vacancies'));
 assert.ok(server.includes('CREATE TABLE IF NOT EXISTS member_job_applications'));
 assert.ok(server.includes("url.pathname==='/api/v1/member/jobs'"));
 assert.ok(server.includes("url.pathname==='/api/v1/member/saved-jobs'"));
 assert.ok(server.includes("url.pathname==='/api/v1/member/applications'"));
 assert.ok(server.includes("v.status='published' AND v.employer_verified=TRUE AND v.legal_route_checked=TRUE"));
 assert.ok(html.includes('id="memberJobs"')&&html.includes('id="memberApplications"'));
 assert.ok(client.includes("api('/api/v1/member/jobs')")&&client.includes("api('/api/v1/member/applications')"));
});

test('membership approval requires auditable evidence before activating privileges', async () => {
 const [server,admin]=await Promise.all([read('server.js'),read('public/admin.js')]);
 assert.ok(server.includes("if(body.request_status==='approved'&&(!evidenceReference||verificationNote.length<10))"));
 assert.ok(server.includes("evidence_reference:evidenceReference,verification_note:verificationNote"));
 assert.ok(admin.includes('evidence_reference:reference?.value||'));
 assert.ok(admin.includes('verification_note:verification?.value||'));
});

test('employer accounts require review and can submit account-linked hiring requirements', async () => {
 const [server,html,client,admin]=await Promise.all([read('server.js'),read('public/account.html'),read('public/account.js'),read('public/admin.js')]);
 assert.ok(server.includes("account_type IN ('member','agent','partner','employer')"));
 assert.ok(server.includes("request_type IN ('subscription','agent','partner','employer')"));
 assert.ok(server.includes("url.pathname==='/api/v1/employer/vacancies'"));
 assert.ok(server.includes("url.pathname==='/api/v1/employer/applications'"));
  assert.ok(server.includes("'under_review',FALSE,FALSE"));
 assert.ok(server.includes('employer_account_id'));
 assert.ok(html.includes('id="employerForm"')&&html.includes('value="employer"'));
 assert.ok(client.includes("api('/api/v1/employer/vacancies')")&&client.includes("api('/api/v1/employer/applications')"));
 assert.ok(server.includes("['agent','partner','employer'].includes(item.request_type)"));
 assert.ok(admin.includes('loadMembershipRequests'));
});

test('employers can review only their own applications with an audit record', async () => {
 const [server,client]=await Promise.all([read('server.js'),read('public/account.js')]);
  assert.ok(server.includes("url.pathname.match(/^\\/api\\/v1\\/employer\\/applications\\/[0-9a-f-]{36}$/i)"));
 assert.ok(server.includes('v.employer_account_id=$2 FOR UPDATE'));
 assert.ok(server.includes('employer.application.status.changed'));
 assert.ok(client.includes("api('/api/v1/employer/applications/'+encodeURIComponent(item.id)"));
});

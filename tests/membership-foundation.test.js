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
 assert.ok(server.includes("['member','agent','partner']"));
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

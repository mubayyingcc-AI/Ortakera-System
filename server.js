import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { randomUUID, createHmac, timingSafeEqual, scrypt as scryptCallback, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import pg from 'pg';

const { Pool } = pg;
const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = 'ortakera_admin';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const root = resolve(process.cwd(), 'public');
const port = Number(process.env.PORT || 3000);
const pool = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
}) : null;

const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.ico':'image/x-icon' };
const rate = new Map();
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 5;
const RATE_MAP_MAX_ENTRIES = 10000;
let rateOperations = 0;

async function migrate() {
  if (!pool) throw new Error('DATABASE_URL is not configured');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS enquiries (
      id UUID PRIMARY KEY,
      reference_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      organization TEXT,
      interest TEXT NOT NULL,
      message TEXT NOT NULL,
      locale TEXT NOT NULL DEFAULT 'en',
      consent_at TIMESTAMPTZ NOT NULL,
      consent_version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','reviewing','responded','closed','spam')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS enquiries_created_at_idx ON enquiries (created_at DESC);
    CREATE INDEX IF NOT EXISTS enquiries_status_idx ON enquiries (status, created_at DESC);
    CREATE TABLE IF NOT EXISTS admin_audit (
      id BIGSERIAL PRIMARY KEY,
      actor_email TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id UUID,
      before_state JSONB,
      after_state JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS admin_audit_created_at_idx ON admin_audit (created_at DESC);
    CREATE TABLE IF NOT EXISTS candidate_profiles (
      id UUID PRIMARY KEY REFERENCES enquiries(id) ON DELETE CASCADE,
      current_location TEXT NOT NULL,
      sector TEXT NOT NULL,
      preferred_role TEXT NOT NULL,
      experience_level TEXT NOT NULL,
      languages TEXT,
      work_eligibility TEXT NOT NULL,
      details TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS employer_requirements (
      id UUID PRIMARY KEY REFERENCES enquiries(id) ON DELETE CASCADE,
      business_location TEXT NOT NULL,
      sector TEXT NOT NULL,
      roles TEXT NOT NULL,
      headcount INTEGER NOT NULL CHECK (headcount > 0),
      pay_range TEXT,
      hiring_timeline TEXT NOT NULL,
      requirements TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS recruitment_partners (
      id UUID PRIMARY KEY REFERENCES enquiries(id) ON DELETE CASCADE,
      agency_name TEXT NOT NULL,
      jurisdiction TEXT NOT NULL,
      licence_status TEXT NOT NULL CHECK (licence_status IN ('licensed','applying','not_required','unsure')),
      licence_reference TEXT,
      website TEXT,
      service_regions TEXT NOT NULL,
      specialisms TEXT NOT NULL,
      candidate_fee_policy TEXT NOT NULL CHECK (candidate_fee_policy IN ('no_candidate_fees','other_or_unclear')),
      compliance_declaration BOOLEAN NOT NULL DEFAULT FALSE,
      review_status TEXT NOT NULL DEFAULT 'received' CHECK (review_status IN ('received','due_diligence','approved','declined','suspended')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS recruitment_partners_status_idx ON recruitment_partners(review_status,created_at DESC);
    CREATE TABLE IF NOT EXISTS job_checks (
      id UUID PRIMARY KEY REFERENCES enquiries(id) ON DELETE CASCADE,
      check_type TEXT NOT NULL CHECK (check_type IN ('job_offer','work_permit','consular_appointment')),
      claimed_employer TEXT NOT NULL,
      claimed_agency TEXT,
      job_title TEXT,
      work_location TEXT,
      appointment_date DATE,
      claimed_status TEXT NOT NULL,
      reference_last4 TEXT,
      evidence_description TEXT NOT NULL,
      review_status TEXT NOT NULL DEFAULT 'received' CHECK (review_status IN ('received','due_diligence','official_source_confirmed','unable_to_verify','suspected_fraud','closed')),
      review_findings TEXT,
      reviewed_by TEXT,
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE job_checks ADD COLUMN IF NOT EXISTS paid_review_requested BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE job_checks DROP CONSTRAINT IF EXISTS job_checks_check_type_check;
    ALTER TABLE job_checks ADD CONSTRAINT job_checks_check_type_check CHECK (check_type IN ('job_offer','work_permit','consular_appointment','invitation_letter','recruitment_agent'));
    ALTER TABLE job_checks ADD COLUMN IF NOT EXISTS candidate_market TEXT NOT NULL DEFAULT 'international' CHECK (candidate_market IN ('local','international'));
    CREATE INDEX IF NOT EXISTS job_checks_status_idx ON job_checks(review_status,created_at DESC);
    CREATE TABLE IF NOT EXISTS job_subscriptions (
      id UUID PRIMARY KEY REFERENCES enquiries(id) ON DELETE CASCADE,
      candidate_market TEXT NOT NULL CHECK (candidate_market IN ('local','international','both')),
      preferred_sectors TEXT NOT NULL, preferred_locations TEXT, preferred_roles TEXT,
      work_authorisation TEXT, frequency TEXT NOT NULL DEFAULT 'weekly' CHECK (frequency IN ('immediate','weekly')),
      active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS job_subscriptions_active_idx ON job_subscriptions(active,created_at DESC);
    CREATE TABLE IF NOT EXISTS vacancies (
      id UUID PRIMARY KEY,
      reference_code TEXT NOT NULL UNIQUE,
      employer_name TEXT NOT NULL,
      title TEXT NOT NULL,
      sector TEXT NOT NULL,
      location TEXT NOT NULL,
      description TEXT NOT NULL,
      gross_pay_range TEXT,
      employment_type TEXT NOT NULL DEFAULT 'Full-time',
      headcount INTEGER NOT NULL DEFAULT 1 CHECK (headcount > 0),
      work_authorisation TEXT NOT NULL DEFAULT 'domestic_only' CHECK (work_authorisation IN ('domestic_only','case_by_case','not_assessed')),
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','under_review','verified','published','closed','rejected')),
      employer_verified BOOLEAN NOT NULL DEFAULT FALSE,
      legal_route_checked BOOLEAN NOT NULL DEFAULT FALSE,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS vacancies_public_idx ON vacancies(status,created_at DESC);
    CREATE TABLE IF NOT EXISTS job_applications (
      id UUID PRIMARY KEY,
      vacancy_id UUID NOT NULL REFERENCES vacancies(id),
      candidate_enquiry_id UUID NOT NULL REFERENCES candidate_profiles(id),
      status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','screening','shortlisted','interview','offered','declined','withdrawn')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(vacancy_id,candidate_enquiry_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS member_accounts (
      id UUID PRIMARY KEY, email TEXT NOT NULL UNIQUE, full_name TEXT NOT NULL,
      password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
      account_type TEXT NOT NULL CHECK(account_type IN ('member','agent','partner')),
      plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free','subscribed')),
      account_status TEXT NOT NULL DEFAULT 'active' CHECK(account_status IN ('active','pending_review','suspended','closed')),
      organization TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_login_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS member_profiles (
      account_id UUID PRIMARY KEY REFERENCES member_accounts(id) ON DELETE CASCADE,
      profile JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS member_sessions (
      id UUID PRIMARY KEY, account_id UUID NOT NULL REFERENCES member_accounts(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS member_sessions_expiry_idx ON member_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS admin_sessions (
      id UUID PRIMARY KEY, email TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx ON admin_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS membership_requests (
      id UUID PRIMARY KEY, account_id UUID NOT NULL REFERENCES member_accounts(id) ON DELETE CASCADE,
      request_type TEXT NOT NULL CHECK(request_type IN ('subscription','agent','partner')),
      request_status TEXT NOT NULL DEFAULT 'pending' CHECK(request_status IN ('pending','approved','declined','cancelled')),
      details JSONB NOT NULL DEFAULT '{}'::jsonb, reviewed_by TEXT, reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS membership_requests_status_idx ON membership_requests(request_status,created_at DESC);
    CREATE TABLE IF NOT EXISTS member_saved_vacancies (
      account_id UUID NOT NULL REFERENCES member_accounts(id) ON DELETE CASCADE,
      vacancy_id UUID NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(account_id,vacancy_id)
    );
    CREATE TABLE IF NOT EXISTS member_job_applications (
      id UUID PRIMARY KEY, account_id UUID NOT NULL REFERENCES member_accounts(id) ON DELETE CASCADE,
      vacancy_id UUID NOT NULL REFERENCES vacancies(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','screening','shortlisted','interview','offered','declined','withdrawn')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(account_id,vacancy_id)
    );
    CREATE INDEX IF NOT EXISTS member_job_applications_account_idx ON member_job_applications(account_id,created_at DESC);
    ALTER TABLE member_accounts DROP CONSTRAINT IF EXISTS member_accounts_account_type_check;
    ALTER TABLE member_accounts ADD CONSTRAINT member_accounts_account_type_check CHECK(account_type IN ('member','agent','partner','employer'));
    ALTER TABLE membership_requests DROP CONSTRAINT IF EXISTS membership_requests_request_type_check;
    ALTER TABLE membership_requests ADD CONSTRAINT membership_requests_request_type_check CHECK(request_type IN ('subscription','agent','partner','employer'));
    ALTER TABLE vacancies ADD COLUMN IF NOT EXISTS employer_account_id UUID REFERENCES member_accounts(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS vacancies_employer_idx ON vacancies(employer_account_id,created_at DESC);
  `);

}

function json(res, status, payload) {
  res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff' });
  res.end(JSON.stringify(payload));
}

function readBody(req, limit = 12000) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(Object.assign(new Error('Request body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Request body must be valid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function clean(value, max) {
  return typeof value === 'string' ? value.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max) : '';
}

function rateAllowed(ip) {
  const now = Date.now();
  if (++rateOperations % 256 === 0 || rate.size >= RATE_MAP_MAX_ENTRIES) {
    for (const [key, item] of rate) {
      if (now - item.start > RATE_WINDOW_MS) rate.delete(key);
      if (rate.size <= RATE_MAP_MAX_ENTRIES * 0.8) break;
    }
    while (rate.size >= RATE_MAP_MAX_ENTRIES) rate.delete(rate.keys().next().value);
  }
  const entry = rate.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    rate.set(ip, { start: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT;
}


function cookieValue(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0,index).trim() === name) return decodeURIComponent(part.slice(index+1).trim());
  }
  return '';
}
function sessionSecret() {
  const value = process.env.SESSION_SECRET || '';
  return value.length >= 32 ? value : null;
}
function sign(value) {
  return createHmac('sha256', sessionSecret()).update(value).digest('base64url');
}
function createSession(email) {
  const payload = Buffer.from(JSON.stringify({ id: randomUUID(), email, exp: Math.floor(Date.now()/1000)+SESSION_TTL_SECONDS })).toString('base64url');
  return payload + '.' + sign(payload);
}
function sessionTokenHash(token) {
  return createHmac('sha256', sessionSecret()).update(token).digest('hex');
}
async function readSession(req) {
  const secret = sessionSecret();
  if (!secret || !pool) return null;
  const token = cookieValue(req, SESSION_COOKIE);
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    if (!data.id || !data.email || !Number.isInteger(data.exp) || data.exp < Math.floor(Date.now()/1000)) return null;
    if (data.email !== (process.env.ADMIN_EMAIL || '').trim().toLowerCase()) return null;
    const active = await pool.query('SELECT id FROM admin_sessions WHERE id=$1 AND email=$2 AND token_hash=$3 AND expires_at>NOW()', [data.id, data.email, sessionTokenHash(token)]);
    return active.rowCount ? data : null;
  } catch { return null; }
}
function setSessionCookie(res, token) {
  res.setHeader('set-cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/admin; Max-Age=${SESSION_TTL_SECONDS}`);
}
function clearSessionCookie(res) {
  res.setHeader('set-cookie', `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/admin; Max-Age=0`);
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    if (parsed.host !== host) return false;
    if (process.env.NODE_ENV === 'production') return parsed.protocol === 'https:';
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch { return false; }
}
async function requireAdmin(req,res) {
  const session = await readSession(req);
  if (!session) { json(res,401,{error:'Administrator sign-in required.'}); return null; }
  return session;
}
async function handleAdminLogin(req,res) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString().split(',')[0].trim();
  if (!rateAllowed('admin:'+ip)) return json(res,429,{error:'Too many sign-in attempts. Try again later.'});
  if (!sameOrigin(req)) return json(res,403,{error:'Request origin rejected.'});
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const passwordHash = process.env.ADMIN_PASSWORD_HASH || '';
  if (!adminEmail || !passwordHash || !sessionSecret()) return json(res,503,{error:'Administrator access is not configured. Set ADMIN_EMAIL, ADMIN_PASSWORD_HASH and SESSION_SECRET in Railway.'});
  let body;
  try { body = await readBody(req,4000); } catch(error) { return json(res,error.status||400,{error:error.message}); }
  const email = clean(body.email,254).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const [saltHex,hashHex] = passwordHash.split(':');
  if (!/^[a-f0-9]{32}$/i.test(saltHex||'') || !/^[a-f0-9]{128}$/i.test(hashHex||'')) return json(res,503,{error:'ADMIN_PASSWORD_HASH has an invalid format. Generate it with npm run admin:hash -- "your-password".'});
  let valid = false;
  try {
    const candidate = await scrypt(password,Buffer.from(saltHex,'hex'),64);
    const expected = Buffer.from(hashHex,'hex');
    valid = candidate.length === expected.length && timingSafeEqual(candidate,expected);
  } catch {}
  if (email !== adminEmail || !valid) return json(res,401,{error:'Email or password is incorrect.'});
  const token=createSession(adminEmail);
  const [payload]=token.split('.');
  const sessionData=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
  await pool.query('DELETE FROM admin_sessions WHERE expires_at<=NOW()');
  await pool.query("INSERT INTO admin_sessions(id,email,token_hash,expires_at) VALUES($1,$2,$3,NOW()+($4 * INTERVAL '1 second'))",[sessionData.id,adminEmail,sessionTokenHash(token),SESSION_TTL_SECONDS]);
  setSessionCookie(res,token);
  return json(res,200,{ok:true,email:adminEmail,expiresIn:SESSION_TTL_SECONDS});
}

const MEMBER_COOKIE='ortakera_member';
const MEMBER_TTL=2592000;
async function memberPassword(password,saltHex){const salt=saltHex?Buffer.from(saltHex,'hex'):randomBytes(16);return {salt:salt.toString('hex'),hash:(await scrypt(password,salt,64)).toString('hex')};}
function setMemberCookie(res,token,maxAge=MEMBER_TTL){res.setHeader('set-cookie',`${MEMBER_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/api/v1; Max-Age=${maxAge}`);}
function memberCookieClear(res){res.setHeader('set-cookie',`${MEMBER_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/api/v1; Max-Age=0`);}
async function currentMember(req){const token=cookieValue(req,MEMBER_COOKIE);if(!token||!sessionSecret())return null;const hash=createHmac('sha256',sessionSecret()).update(token).digest('hex');const q=await pool.query("SELECT a.id,a.email,a.full_name,a.account_type,a.plan,a.account_status,a.organization FROM member_sessions s JOIN member_accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>NOW()",[hash]);return q.rows[0]||null;}
async function handleMemberApi(req,res,url){
 if(!pool)return json(res,503,{error:'Member service unavailable.'});
 if(req.method==='POST'&&url.pathname==='/api/v1/member/register'){
  if(!sameOrigin(req))return json(res,403,{error:'Origin rejected.'});
  let b;try{b=await readBody(req,5000)}catch(e){return json(res,e.status||400,{error:e.message})}
  const name=clean(b.full_name,120),email=clean(b.email,254).toLowerCase(),password=typeof b.password==='string'?b.password:'',type=b.account_type||'member',org=clean(b.organization,180)||null;
  if(name.length<2||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<12||password.length>200||!['member','agent','partner','employer'].includes(type)||(['agent','partner','employer'].includes(type)&&!org))return json(res,422,{error:'Enter valid details. Password must contain at least 12 characters; agents, partners and employers must provide an organisation.'});
  const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').toString().split(',')[0].trim();
  if(!rateAllowed('member-register:'+ip))return json(res,429,{error:'Too many registration attempts. Try again later.'});
  const id=randomUUID(),pw=await memberPassword(password),status=type==='member'?'active':'pending_review';
  const client=await pool.connect();try{await client.query('BEGIN');await client.query('INSERT INTO member_accounts(id,email,full_name,password_salt,password_hash,account_type,account_status,organization) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,email,name,pw.salt,pw.hash,type,status,org]);if(type!=='member')await client.query('INSERT INTO membership_requests(id,account_id,request_type,details) VALUES($1,$2,$3,$4::jsonb)',[randomUUID(),id,type,JSON.stringify({organization:org})]);await client.query('COMMIT');return json(res,201,{ok:true,account:{id,email,full_name:name,account_type:type,plan:'free',account_status:status},message:type==='member'?'Free account created. Sign in.':'Application received; access is pending review.'});}catch(e){await client.query('ROLLBACK');if(e.code==='23505')return json(res,409,{error:'An account with this email already exists.'});console.error('Member registration:',e.code||e.name);return json(res,500,{error:'Could not create account.'});}finally{client.release()}
 }
 if(req.method==='POST'&&url.pathname==='/api/v1/member/login'){
  const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').toString().split(',')[0].trim();if(!rateAllowed('member-login:'+ip))return json(res,429,{error:'Too many sign-in attempts. Try again later.'});
  if(!sessionSecret())return json(res,503,{error:'Member sessions are not configured.'});
  if(!sameOrigin(req))return json(res,403,{error:'Origin rejected.'});
  let b;try{b=await readBody(req,3000)}catch(e){return json(res,e.status||400,{error:e.message})}
  const email=clean(b.email,254).toLowerCase(),password=typeof b.password==='string'?b.password:'',q=await pool.query('SELECT * FROM member_accounts WHERE email=$1',[email]);
  if(!q.rowCount)return json(res,401,{error:'Email or password is incorrect.'});
  const a=q.rows[0],candidate=await memberPassword(password,a.password_salt),x=Buffer.from(candidate.hash,'hex'),y=Buffer.from(a.password_hash,'hex');
  if(x.length!==y.length||!timingSafeEqual(x,y))return json(res,401,{error:'Email or password is incorrect.'});
  if(['suspended','closed'].includes(a.account_status))return json(res,403,{error:'Account unavailable.'});
  await pool.query('DELETE FROM member_sessions WHERE expires_at <= NOW()');
  const raw=randomBytes(32).toString('base64url'),hash=createHmac('sha256',sessionSecret()).update(raw).digest('hex');
  await pool.query("INSERT INTO member_sessions(id,account_id,token_hash,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '30 days')",[randomUUID(),a.id,hash]);await pool.query('UPDATE member_accounts SET last_login_at=NOW() WHERE id=$1',[a.id]);setMemberCookie(res,raw);
  return json(res,200,{ok:true,account:{id:a.id,email:a.email,full_name:a.full_name,account_type:a.account_type,plan:a.plan,account_status:a.account_status}});
 }
 if(req.method==='POST'&&url.pathname==='/api/v1/member/logout'){if(!sameOrigin(req))return json(res,403,{error:'Origin rejected.'});const token=cookieValue(req,MEMBER_COOKIE);if(token){const hash=createHmac('sha256',sessionSecret()).update(token).digest('hex');await pool.query('DELETE FROM member_sessions WHERE token_hash=$1',[hash]);}memberCookieClear(res);return json(res,200,{ok:true});}
 if(req.method==='POST'&&url.pathname==='/api/v1/member/logout-all'){
  if(!sameOrigin(req))return json(res,403,{error:'Origin rejected.'});
  const account=await currentMember(req);
  if(!account)return json(res,401,{error:'Sign in required.'});
  await pool.query('DELETE FROM member_sessions WHERE account_id=$1',[account.id]);
  memberCookieClear(res);
  return json(res,200,{ok:true,message:'All active sessions have been revoked. Sign in again on this device if needed.'});
 }
 const a=await currentMember(req);
 if(req.method==='GET'&&url.pathname==='/api/v1/member/me'){if(!a)return json(res,401,{error:'Sign in required.'});return json(res,200,{ok:true,account:a});}


 if(req.method==='GET'&&url.pathname==='/api/v1/employer/vacancies'){
  if(!a)return json(res,401,{error:'Sign in required.'});if(a.account_type!=='employer'||a.account_status!=='active')return json(res,403,{error:'An approved employer account is required.'});
  const q=await pool.query('SELECT v.*,COUNT(ma.id)::int AS application_count FROM vacancies v LEFT JOIN member_job_applications ma ON ma.vacancy_id=v.id WHERE v.employer_account_id=$1 GROUP BY v.id ORDER BY v.created_at DESC',[a.id]);return json(res,200,{items:q.rows});
 }
 if(req.method==='POST'&&url.pathname==='/api/v1/employer/vacancies'){
  if(!a)return json(res,401,{error:'Sign in required.'});if(a.account_type!=='employer'||a.account_status!=='active')return json(res,403,{error:'An approved employer account is required.'});if(!sameOrigin(req))return json(res,403,{error:'Origin rejected.'});
  let b;try{b=await readBody(req,7000)}catch(e){return json(res,e.status||400,{error:e.message})}
  const title=clean(b.title,140),sector=clean(b.sector,100),location=clean(b.location,160),description=clean(b.description,4000),pay=clean(b.gross_pay_range,120),type=clean(b.employment_type,50)||'Full-time',count=Number(b.headcount||1),auth=b.work_authorisation||'not_assessed';
  if(title.length<3||sector.length<2||location.length<2||description.length<40||!Number.isInteger(count)||count<1||count>500||!['Full-time','Part-time','Contract','Temporary','Seasonal'].includes(type)||!['domestic_only','case_by_case','not_assessed'].includes(auth))return json(res,422,{error:'Provide a valid role, sector, location, detailed working conditions, headcount and work-authorisation position.'});
  const id=randomUUID(),ref='ORT-'+randomBytes(5).toString('hex').toUpperCase();
  const q=await pool.query("INSERT INTO vacancies(id,reference_code,employer_name,title,sector,location,description,gross_pay_range,employment_type,headcount,work_authorisation,status,employer_verified,legal_route_checked,created_by,employer_account_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'under_review',FALSE,FALSE,$12,$13) RETURNING id,reference_code,title,status,created_at",[id,ref,a.organization||a.full_name,title,sector,location,description,pay,type,count,auth,a.email,a.id]);
  return json(res,201,{ok:true,item:q.rows[0],message:'Hiring requirement saved for review. It is not published and candidates cannot apply yet.'});
 }
 if(req.method==='GET'&&url.pathname==='/api/v1/employer/applications'){
  if(!a)return json(res,401,{error:'Sign in required.'});if(a.account_type!=='employer'||a.account_status!=='active')return json(res,403,{error:'An approved employer account is required.'});
  const q=await pool.query('SELECT ma.id,ma.status,ma.created_at,ma.updated_at,v.reference_code,v.title,v.location FROM member_job_applications ma JOIN vacancies v ON v.id=ma.vacancy_id WHERE v.employer_account_id=$1 ORDER BY ma.created_at DESC',[a.id]);return json(res,200,{items:q.rows});
 }

  if(req.method==='PATCH'&&url.pathname.match(/^\/api\/v1\/employer\/applications\/[0-9a-f-]{36}$/i)){
  if(!a)return json(res,401,{error:'Sign in required.'});if(a.account_type!=='employer'||a.account_status!=='active')return json(res,403,{error:'An approved employer account is required.'});if(!sameOrigin(req))return json(res,403,{error:'Origin rejected.'});
  let b;try{b=await readBody(req,1500)}catch(e){return json(res,e.status||400,{error:e.message})}
  const allowed=['screening','shortlisted','interview','offered','declined'];
  if(!allowed.includes(b.status))return json(res,422,{error:'Choose a valid application status.'});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const current=await client.query('SELECT ma.*,v.title,v.reference_code FROM member_job_applications ma JOIN vacancies v ON v.id=ma.vacancy_id WHERE ma.id=$1 AND v.employer_account_id=$2 FOR UPDATE',[url.pathname.split('/').pop(),a.id]);
   if(!current.rowCount){await client.query('ROLLBACK');return json(res,404,{error:'Application not found for this employer.'})}
   const updated=await client.query('UPDATE member_job_applications SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING id,status,updated_at',[b.status,current.rows[0].id]);
   await client.query('INSERT INTO admin_audit(actor_email,action,entity_type,entity_id,before_state,after_state) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)',[a.email,'employer.application.status.changed','member_job_application',current.rows[0].id,JSON.stringify({status:current.rows[0].status}),JSON.stringify(updated.rows[0])]);
   await client.query('COMMIT');return json(res,200,{ok:true,item:updated.rows[0]});
  }catch(e){await client.query('ROLLBACK');console.error('Employer application update failed:',e.code||e.name);return json(res,500,{error:'Could not update application.'})}finally{client.release()}
 }
 if(req.method==='GET'&&url.pathname==='/api/v1/member/jobs'){
  if(!a)return json(res,401,{error:'Sign in required.'});
  const q=await pool.query(`SELECT v.reference_code,v.title,v.sector,v.location,v.description,v.gross_pay_range,v.employment_type,v.headcount,v.created_at,(sv.account_id IS NOT NULL) AS saved,(ma.id IS NOT NULL) AS applied FROM vacancies v LEFT JOIN member_saved_vacancies sv ON sv.vacancy_id=v.id AND sv.account_id=$1 LEFT JOIN member_job_applications ma ON ma.vacancy_id=v.id AND ma.account_id=$1 WHERE v.status='published' AND v.employer_verified=TRUE AND v.legal_route_checked=TRUE ORDER BY v.created_at DESC LIMIT 100`,[a.id]);
  return json(res,200,{items:q.rows});
 }
 if(req.method==='POST'&&url.pathname==='/api/v1/member/saved-jobs'){
  if(!a)return json(res,401,{error:'Sign in required.'});if(!sameOrigin(req))return json(res,403,{error:'Origin rejected.'});
  let b;try{b=await readBody(req,1000)}catch(e){return json(res,e.status||400,{error:e.message})}
  const ref=clean(b.reference_code,40).toUpperCase();if(!ref)return json(res,422,{error:'Opportunity reference is required.'});
  const v=await pool.query("SELECT id FROM vacancies WHERE reference_code=$1 AND status='published' AND employer_verified=TRUE AND legal_route_checked=TRUE",[ref]);if(!v.rowCount)return json(res,404,{error:'This opportunity is not currently available.'});
  await pool.query('INSERT INTO member_saved_vacancies(account_id,vacancy_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[a.id,v.rows[0].id]);return json(res,200,{ok:true,saved:true});
 }
 if(req.method==='DELETE'&&url.pathname==='/api/v1/member/saved-jobs'){
  if(!a)return json(res,401,{error:'Sign in required.'});if(!sameOrigin(req))return json(res,403,{error:'Origin rejected.'});
  let b;try{b=await readBody(req,1000)}catch(e){return json(res,e.status||400,{error:e.message})}
  const ref=clean(b.reference_code,40).toUpperCase();await pool.query('DELETE FROM member_saved_vacancies sv USING vacancies v WHERE sv.vacancy_id=v.id AND sv.account_id=$1 AND v.reference_code=$2',[a.id,ref]);return json(res,200,{ok:true,saved:false});
 }
 if(req.method==='POST'&&url.pathname==='/api/v1/member/applications'){
  if(!a)return json(res,401,{error:'Sign in required.'});if(a.account_type!=='member')return json(res,403,{error:'This account type cannot submit candidate applications.'});if(!sameOrigin(req))return json(res,403,{error:'Origin rejected.'});
  let b;try{b=await readBody(req,1500)}catch(e){return json(res,e.status||400,{error:e.message})}
  const ref=clean(b.reference_code,40).toUpperCase();if(!ref)return json(res,422,{error:'Opportunity reference is required.'});
  const v=await pool.query("SELECT id FROM vacancies WHERE reference_code=$1 AND status='published' AND employer_verified=TRUE AND legal_route_checked=TRUE",[ref]);if(!v.rowCount)return json(res,404,{error:'This opportunity is not currently available.'});
  try{const q=await pool.query("INSERT INTO member_job_applications(id,account_id,vacancy_id) VALUES($1,$2,$3) RETURNING id,status,created_at",[randomUUID(),a.id,v.rows[0].id]);return json(res,201,{ok:true,application:q.rows[0]})}catch(e){if(e.code==='23505')return json(res,409,{error:'You have already applied for this opportunity.'});throw e}
 }
 if(req.method==='GET'&&url.pathname==='/api/v1/member/applications'){
  if(!a)return json(res,401,{error:'Sign in required.'});
  const q=await pool.query('SELECT m.id,m.status,m.created_at,m.updated_at,v.reference_code,v.title,v.location FROM member_job_applications m JOIN vacancies v ON v.id=m.vacancy_id WHERE m.account_id=$1 ORDER BY m.created_at DESC',[a.id]);return json(res,200,{items:q.rows});
 }
 if(req.method==='GET'&&url.pathname==='/api/v1/member/profile'){
  if(!a)return json(res,401,{error:'Sign in required.'});
  const q=await pool.query('SELECT profile,updated_at FROM member_profiles WHERE account_id=$1',[a.id]);
  return json(res,200,{profile:q.rows[0]?.profile||{},updated_at:q.rows[0]?.updated_at||null});
 }
 if(req.method==='PATCH'&&url.pathname==='/api/v1/member/profile'){
  if(!a)return json(res,401,{error:'Sign in required.'});
  if(!sameOrigin(req))return json(res,403,{error:'Origin rejected.'});
  let b;try{b=await readBody(req,5000)}catch(e){return json(res,e.status||400,{error:e.message})}
  if(!b||typeof b!=='object'||Array.isArray(b))return json(res,400,{error:'Profile must be an object.'});
  const allowed=['country','city','bio','preferred_sectors','preferred_roles','languages','website','operating_regions','specialisms','licensing_status'];
  const profile={};
  for(const key of allowed){if(b[key]!==undefined){if(typeof b[key]!=='string')return json(res,422,{error:'Profile fields must be text.'});profile[key]=clean(b[key],key==='bio'?1200: key==='website'?240: key==='licensing_status'?80:300)}}
  if(profile.website&&!/^https:\/\//i.test(profile.website))return json(res,422,{error:'Website must use an https:// address.'});
  if(['agent','partner'].includes(a.account_type)&&profile.licensing_status&& !['licensed','applying','not_required','unsure'].includes(profile.licensing_status))return json(res,422,{error:'Choose a valid authorisation status.'});
  const saved=await pool.query("INSERT INTO member_profiles(account_id,profile,updated_at) VALUES($1,$2::jsonb,NOW()) ON CONFLICT(account_id) DO UPDATE SET profile=member_profiles.profile || EXCLUDED.profile,updated_at=NOW() RETURNING profile,updated_at",[a.id,JSON.stringify(profile)]);
  return json(res,200,{ok:true,...saved.rows[0]});
 }
 if(!a)return json(res,401,{error:'Sign in required.'});
 if(a.account_status!=='active')return json(res,403,{error:'Account is pending review or inactive.'});
 if(req.method==='POST'&&url.pathname==='/api/v1/member/requests'){
  if(!sameOrigin(req))return json(res,403,{error:'Origin rejected.'});let b;try{b=await readBody(req,2000)}catch(e){return json(res,e.status||400,{error:e.message})}
  if(b.request_type!=='subscription')return json(res,422,{error:'Unsupported request.'});if(a.plan==='subscribed')return json(res,409,{error:'Already subscribed.'});
  const p=await pool.query("SELECT id FROM membership_requests WHERE account_id=$1 AND request_type='subscription' AND request_status='pending'",[a.id]);if(p.rowCount)return json(res,409,{error:'A subscription request is already pending.'});
  const id=randomUUID();await pool.query("INSERT INTO membership_requests(id,account_id,request_type,details) VALUES($1,$2,'subscription',$3::jsonb)",[id, a.id,JSON.stringify({source:'member_portal'})]);return json(res,201,{ok:true,request_id:id,request_status:'pending',message:'Request received. Subscribed access activates only after payment verification or an approved arrangement.'});
 }
 if(req.method==='GET'&&url.pathname==='/api/v1/member/requests'){const q=await pool.query('SELECT id,request_type,request_status,created_at,reviewed_at FROM membership_requests WHERE account_id=$1 ORDER BY created_at DESC',[a.id]);return json(res,200,{items:q.rows});}
 return json(res,404,{error:'Member endpoint not found.'});
}

async function handleAdminApi(req,res,url) {
  if (req.method === 'POST' && url.pathname === '/api/v1/admin/login') return handleAdminLogin(req,res);
  if (req.method === 'POST' && url.pathname === '/api/v1/admin/logout') {
    if (!sameOrigin(req)) return json(res,403,{error:'Request origin rejected.'});
    const token=cookieValue(req,SESSION_COOKIE);
    if(token && sessionSecret() && pool) await pool.query('DELETE FROM admin_sessions WHERE token_hash=$1',[sessionTokenHash(token)]);
    clearSessionCookie(res); return json(res,200,{ok:true});
  }
  const admin = await requireAdmin(req,res);
  if (!admin) return;
  if (req.method === 'GET' && url.pathname === '/api/v1/admin/session') return json(res,200,{ok:true,email:admin.email});
  if (req.method === 'GET' && url.pathname === '/api/v1/admin/applications') {
    const result=await pool.query(`SELECT a.id,a.status,a.created_at,v.reference_code AS vacancy_reference,v.title,e.reference_code AS candidate_reference,e.name,e.email FROM job_applications a JOIN vacancies v ON v.id=a.vacancy_id JOIN enquiries e ON e.id=a.candidate_enquiry_id ORDER BY a.created_at DESC LIMIT 300`);
    return json(res,200,{items:result.rows});
  }
  if(req.method==='GET'&&url.pathname==='/api/v1/admin/job-subscriptions'){
    const result=await pool.query(`SELECT s.*,e.reference_code,e.name,e.email,e.created_at AS request_created_at FROM job_subscriptions s JOIN enquiries e ON e.id=s.id ORDER BY s.created_at DESC LIMIT 500`);
    return json(res,200,{items:result.rows});
  }
  if(req.method==='GET'&&url.pathname==='/api/v1/admin/job-checks'){
    const result=await pool.query(`SELECT c.*,e.reference_code,e.name,e.email,e.organization,e.created_at AS request_created_at FROM job_checks c JOIN enquiries e ON e.id=c.id ORDER BY c.created_at DESC LIMIT 300`);
    return json(res,200,{items:result.rows});
  }
  const jobCheckMatch=url.pathname.match(/^\/api\/v1\/admin\/job-checks\/([0-9a-f-]{36})$/i);
  if(req.method==='PATCH'&&jobCheckMatch){
    if(!sameOrigin(req))return json(res,403,{error:'Request origin rejected.'});
    let body;try{body=await readBody(req,3500)}catch(error){return json(res,error.status||400,{error:error.message})}
    const allowed=['received','due_diligence','official_source_confirmed','unable_to_verify','suspected_fraud','closed'];
    if(!allowed.includes(body.review_status))return json(res,422,{error:'Invalid verification review status.'});
    const findings=clean(body.review_findings,2500);
    if(body.review_status==='official_source_confirmed'&&findings.length<20)return json(res,422,{error:'Record the official source and what was confirmed before marking this verified.'});
    const current=await pool.query('SELECT * FROM job_checks WHERE id=$1',[jobCheckMatch[1]]);
    if(!current.rowCount)return json(res,404,{error:'Verification request not found.'});
    const updated=await pool.query('UPDATE job_checks SET review_status=$1,review_findings=$2,reviewed_by=$3,reviewed_at=NOW(),updated_at=NOW() WHERE id=$4 RETURNING *',[body.review_status,findings||null,admin.email,jobCheckMatch[1]]);
    await pool.query('INSERT INTO admin_audit(actor_email,action,entity_type,entity_id,before_state,after_state) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)',[admin.email,'job_check.reviewed','job_check',jobCheckMatch[1],JSON.stringify(current.rows[0]),JSON.stringify(updated.rows[0])]);
    return json(res,200,{ok:true,item:updated.rows[0]});
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/admin/recruitment-partners') {
    const result=await pool.query(`SELECT p.*,e.reference_code,e.name,e.email,e.organization,e.created_at AS enquiry_created_at FROM recruitment_partners p JOIN enquiries e ON e.id=p.id ORDER BY p.created_at DESC LIMIT 200`);
    return json(res,200,{items:result.rows});
  }
  const partnerMatch=url.pathname.match(/^\/api\/v1\/admin\/recruitment-partners\/([0-9a-f-]{36})$/i);
  if(req.method==='PATCH'&&partnerMatch){
    if(!sameOrigin(req))return json(res,403,{error:'Request origin rejected.'});
    let body;try{body=await readBody(req,1500)}catch(error){return json(res,error.status||400,{error:error.message})}
    const allowed=['received','due_diligence','approved','declined','suspended'];
    if(!allowed.includes(body.review_status))return json(res,422,{error:'Invalid partner review status.'});
    const current=await pool.query('SELECT * FROM recruitment_partners WHERE id=$1',[partnerMatch[1]]);
    if(!current.rowCount)return json(res,404,{error:'Recruitment partner not found.'});
    const updated=await pool.query('UPDATE recruitment_partners SET review_status=$1,updated_at=NOW() WHERE id=$2 RETURNING *',[body.review_status,partnerMatch[1]]);
    await pool.query('INSERT INTO admin_audit(actor_email,action,entity_type,entity_id,before_state,after_state) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)',[admin.email,'recruitment_partner.reviewed','recruitment_partner',partnerMatch[1],JSON.stringify(current.rows[0]),JSON.stringify(updated.rows[0])]);
    return json(res,200,{ok:true,item:updated.rows[0]});
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/admin/candidates') {
    const result=await pool.query(`SELECT e.id,e.reference_code,e.name,e.email,e.status,e.created_at,c.current_location,c.sector,c.preferred_role,c.experience_level,c.languages,c.work_eligibility,c.details FROM candidate_profiles c JOIN enquiries e ON e.id=c.id ORDER BY e.created_at DESC LIMIT 200`);
    return json(res,200,{items:result.rows});
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/admin/employer-requirements') {
    const result=await pool.query(`SELECT e.id,e.reference_code,e.name,e.email,e.organization,e.status,e.created_at,r.business_location,r.sector,r.roles,r.headcount,r.pay_range,r.hiring_timeline,r.requirements FROM employer_requirements r JOIN enquiries e ON e.id=r.id ORDER BY e.created_at DESC LIMIT 200`);
    return json(res,200,{items:result.rows});
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/admin/vacancies') {
    const result=await pool.query('SELECT * FROM vacancies ORDER BY created_at DESC LIMIT 200');
    return json(res,200,{items:result.rows});
  }
  if (req.method === 'POST' && url.pathname === '/api/v1/admin/vacancies') {
    if (!sameOrigin(req)) return json(res,403,{error:'Request origin rejected.'});
    let body; try { body=await readBody(req,8000); } catch(error) { return json(res,error.status||400,{error:error.message}); }
    const employer=clean(body.employer_name,160), title=clean(body.title,160), sector=clean(body.sector,100), location=clean(body.location,120), description=clean(body.description,3000), pay=clean(body.gross_pay_range,120)||null, type=clean(body.employment_type,60)||'Full-time', count=Number(body.headcount||1), auth=body.work_authorisation;
    if(!employer||!title||!sector||!location||description.length<20||!Number.isInteger(count)||count<1||count>5000||!['domestic_only','case_by_case','not_assessed'].includes(auth)) return json(res,422,{error:'Complete the required vacancy fields with valid values.'});
    const id=randomUUID(), reference='JOB-'+new Date().getUTCFullYear()+'-'+id.slice(0,8).toUpperCase();
    const result=await pool.query(`INSERT INTO vacancies(id,reference_code,employer_name,title,sector,location,description,gross_pay_range,employment_type,headcount,work_authorisation,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[id,reference,employer,title,sector,location,description,pay,type,count,auth,admin.email]);
    await pool.query('INSERT INTO admin_audit(actor_email,action,entity_type,entity_id,after_state) VALUES($1,$2,$3,$4,$5::jsonb)',[admin.email,'vacancy.created','vacancy',id,JSON.stringify(result.rows[0])]);
    return json(res,201,{ok:true,item:result.rows[0]});
  }
  const vacancyMatch=url.pathname.match(/^\/api\/v1\/admin\/vacancies\/([0-9a-f-]{36})$/i);
  if(req.method==='PATCH'&&vacancyMatch){
    if(!sameOrigin(req)) return json(res,403,{error:'Request origin rejected.'});
    let body;try{body=await readBody(req,3000)}catch(error){return json(res,error.status||400,{error:error.message})}
    const allowed=['draft','under_review','verified','published','closed','rejected'];
    if(body.status!==undefined&&!allowed.includes(body.status))return json(res,422,{error:'Invalid vacancy status.'});
    if(body.employer_verified!==undefined&&typeof body.employer_verified!=='boolean')return json(res,422,{error:'employer_verified must be boolean.'});
    if(body.legal_route_checked!==undefined&&typeof body.legal_route_checked!=='boolean')return json(res,422,{error:'legal_route_checked must be boolean.'});
    const current=await pool.query('SELECT * FROM vacancies WHERE id=$1',[vacancyMatch[1]]);
    if(!current.rowCount)return json(res,404,{error:'Vacancy not found.'});
    const employerVerified=body.employer_verified??current.rows[0].employer_verified;
    const legalChecked=body.legal_route_checked??current.rows[0].legal_route_checked;
    const nextStatus=body.status??current.rows[0].status;
    if(nextStatus==='published'&&(!employerVerified||!legalChecked))return json(res,422,{error:'Publishing is blocked until employer verification and legal-route review are both confirmed.'});
    const updated=await pool.query('UPDATE vacancies SET status=$1,employer_verified=$2,legal_route_checked=$3,updated_at=NOW() WHERE id=$4 RETURNING *',[nextStatus,employerVerified,legalChecked,vacancyMatch[1]]);
    await pool.query('INSERT INTO admin_audit(actor_email,action,entity_type,entity_id,before_state,after_state) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)',[admin.email,'vacancy.status.changed','vacancy',vacancyMatch[1],JSON.stringify(current.rows[0]),JSON.stringify(updated.rows[0])]);
    return json(res,200,{ok:true,item:updated.rows[0]});
  }
  if(req.method==='PATCH'&&url.pathname.startsWith('/api/v1/admin/vacancies/')){
    return json(res,404,{error:'Vacancy not found.'});
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/admin/enquiries') {
    if (!pool) return json(res,503,{error:'Database unavailable.'});
    const allowed = ['received','reviewing','responded','closed','spam'];
    const status = url.searchParams.get('status') || 'all';
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')||50),1),100);
    if (status !== 'all' && !allowed.includes(status)) return json(res,400,{error:'Invalid status filter.'});
    try {
      const result = status === 'all'
        ? await pool.query('SELECT id,reference_code,name,email,organization,interest,message,locale,status,created_at,updated_at FROM enquiries ORDER BY created_at DESC LIMIT $1',[limit])
        : await pool.query('SELECT id,reference_code,name,email,organization,interest,message,locale,status,created_at,updated_at FROM enquiries WHERE status=$1 ORDER BY created_at DESC LIMIT $2',[status,limit]);
      const counts = await pool.query("SELECT status,COUNT(*)::int AS count FROM enquiries GROUP BY status");
      return json(res,200,{items:result.rows,counts:Object.fromEntries(counts.rows.map(row=>[row.status,row.count])),limit});
    } catch(error) { console.error('Admin enquiry read failed:',error.code||error.name); return json(res,500,{error:'Could not load enquiries.'}); }
  }
  const match = url.pathname.match(/^\/api\/v1\/admin\/enquiries\/([0-9a-f-]{36})$/i);
  if (req.method === 'PATCH' && match) {
    if (!sameOrigin(req)) return json(res,403,{error:'Request origin rejected.'});
    if (!pool) return json(res,503,{error:'Database unavailable.'});
    let body;
    try { body = await readBody(req,2000); } catch(error) { return json(res,error.status||400,{error:error.message}); }
    const allowed = ['received','reviewing','responded','closed','spam'];
    if (!allowed.includes(body.status)) return json(res,422,{error:'Invalid enquiry status.'});
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const before = await client.query('SELECT id,reference_code,status FROM enquiries WHERE id=$1 FOR UPDATE',[match[1]]);
      if (!before.rowCount) { await client.query('ROLLBACK'); return json(res,404,{error:'Enquiry not found.'}); }
      const updated = await client.query('UPDATE enquiries SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING id,reference_code,status,updated_at',[body.status,match[1]]);
      await client.query('INSERT INTO admin_audit (actor_email,action,entity_type,entity_id,before_state,after_state) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)',[admin.email,'enquiry.status.changed','enquiry',match[1],JSON.stringify(before.rows[0]),JSON.stringify(updated.rows[0])]);
      await client.query('COMMIT');
      return json(res,200,{ok:true,item:updated.rows[0]});
    } catch(error) {
      await client.query('ROLLBACK'); console.error('Admin status update failed:',error.code||error.name);
      return json(res,500,{error:'Could not update enquiry status.'});
    } finally { client.release(); }
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/admin/audit') {
    if (!pool) return json(res,503,{error:'Database unavailable.'});
    try {
      const result=await pool.query('SELECT actor_email,action,entity_type,entity_id,before_state,after_state,created_at FROM admin_audit ORDER BY created_at DESC LIMIT 100');
      return json(res,200,{items:result.rows});
    } catch(error) { console.error('Admin audit read failed:',error.code||error.name); return json(res,500,{error:'Could not load audit history.'}); }
  }
  if(req.method==='GET'&&url.pathname==='/api/v1/admin/membership-requests'){
    const q=await pool.query(`SELECT r.id,r.request_type,r.request_status,r.details,r.created_at,a.id AS account_id,a.email,a.full_name,a.account_type,a.plan,a.account_status,a.organization FROM membership_requests r JOIN member_accounts a ON a.id=r.account_id ORDER BY r.created_at DESC LIMIT 300`);
    return json(res,200,{items:q.rows});
  }
  const membershipMatch=url.pathname.match(/^\/api\/v1\/admin\/membership-requests\/([0-9a-f-]{36})$/i);
  if(req.method==='PATCH'&&membershipMatch){
    if(!sameOrigin(req))return json(res,403,{error:'Request origin rejected.'});
    let body;try{body=await readBody(req,2000)}catch(error){return json(res,error.status||400,{error:error.message})}
    if(!['approved','declined'].includes(body.request_status))return json(res,422,{error:'Choose approved or declined.'});
    const evidenceReference=clean(body.evidence_reference,120),verificationNote=clean(body.verification_note,1000);
    const client=await pool.connect();
    try{
      await client.query('BEGIN');
      const current=await client.query('SELECT r.*,a.account_type,a.plan,a.account_status,a.id AS account_id FROM membership_requests r JOIN member_accounts a ON a.id=r.account_id WHERE r.id=$1 FOR UPDATE',[membershipMatch[1]]);
      if(!current.rowCount){await client.query('ROLLBACK');return json(res,404,{error:'Membership request not found.'})}
      const item=current.rows[0];
      if(item.request_status!=='pending'){await client.query('ROLLBACK');return json(res,409,{error:'This request has already been reviewed.'})}
      if(body.request_status==='approved'&&(!evidenceReference||verificationNote.length<10)){await client.query('ROLLBACK');return json(res,422,{error:item.request_type==='subscription'?'Provide a payment or approved-arrangement reference and a verification note of at least 10 characters.':'Provide a due-diligence evidence reference and a verification note of at least 10 characters.'})}
      if(item.request_type==='subscription'&&body.request_status==='approved')await client.query("UPDATE member_accounts SET plan='subscribed',updated_at=NOW() WHERE id=$1",[item.account_id]);
      if(['agent','partner','employer'].includes(item.request_type)&&body.request_status==='approved')await client.query("UPDATE member_accounts SET account_status='active',updated_at=NOW() WHERE id=$1",[item.account_id]);
      if(body.request_status==='declined'&&['agent','partner','employer'].includes(item.request_type))await client.query("UPDATE member_accounts SET account_status='suspended',updated_at=NOW() WHERE id=$1",[item.account_id]);
      const detailPatch=body.request_status==='approved'?{evidence_reference:evidenceReference,verification_note:verificationNote,verified_by:admin.email,verified_at:new Date().toISOString()}: {review_note:verificationNote,reviewed_by:admin.email,reviewed_at:new Date().toISOString()};
      const updated=await client.query('UPDATE membership_requests SET request_status=$1,details=details || $2::jsonb,reviewed_by=$3,reviewed_at=NOW() WHERE id=$4 RETURNING *',[body.request_status,JSON.stringify(detailPatch),admin.email,membershipMatch[1]]);
      await client.query('INSERT INTO admin_audit(actor_email,action,entity_type,entity_id,before_state,after_state) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb)',[admin.email,'membership_request.reviewed','membership_request',membershipMatch[1],JSON.stringify(item),JSON.stringify(updated.rows[0])]);
      await client.query('COMMIT');return json(res,200,{ok:true,item:updated.rows[0]});
    }catch(error){await client.query('ROLLBACK');console.error('Membership review failed:',error.code||error.name);return json(res,500,{error:'Could not update membership request.'})}finally{client.release()}
  }
  return json(res,404,{error:'Admin endpoint not found.'});
}

async function handleEnquiry(req, res) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString().split(',')[0].trim();
  if (!rateAllowed(ip)) return json(res, 429, { error:'Too many enquiries from this connection. Please try again later.' });
  if (!pool) return json(res, 503, { error:'Enquiry service is not configured yet. Please try again later.' });

  let body;
  try { body = await readBody(req); }
  catch (error) { return json(res, error.status || 400, { error:error.message }); }

  const name = clean(body.name, 120);
  const email = clean(body.email, 254).toLowerCase();
  const organization = clean(body.organization, 160) || null;
  const interest = clean(body.interest, 40);
  const message = clean(body.message, 4000);
  const locale = ['en','tr','de','ru','ar','pt','it','ja','ko','zh'].includes(body.locale) ? body.locale : 'en';
  const consent = body.consent === true;
  const fields = body.fields && typeof body.fields === 'object' ? body.fields : {};
  const validInterests = ['business','partnership','capability','other','employment_candidate','employer_hiring','recruitment_partner','job_check','job_subscription'];

  if (name.length < 2) return json(res, 422, { error:'Please enter your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 422, { error:'Please enter a valid email address.' });
  if (!validInterests.includes(interest)) return json(res, 422, { error:'Please choose an enquiry category.' });
  if (message.length < 10) return json(res, 422, { error:'Please provide a little more detail (at least 10 characters).' });
  if (!consent) return json(res, 422, { error:'Consent is required before we can store this enquiry.' });

  const id = randomUUID();
  const reference = `ORT-${new Date().getUTCFullYear()}-${id.slice(0,8).toUpperCase()}`;
  try {
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO enquiries (id, reference_code, name, email, organization, interest, message, locale, consent_at, consent_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),'privacy-notice-2026-10')`,[id,reference,name,email,organization,interest,message,locale]);
      if(interest==='employment_candidate'){
        const location=clean(fields.location,120),sector=clean(fields.sector,100),role=clean(fields.role,160),experience=clean(fields.experience,40),languages=clean(fields.languages,160),eligibility=clean(fields.eligibility,80),details=clean(fields.details,1500);
        if(!location||!sector||!role||!experience||!eligibility)throw Object.assign(new Error('Candidate profile is missing required structured fields.'),{status:422});
        await client.query('INSERT INTO candidate_profiles(id,current_location,sector,preferred_role,experience_level,languages,work_eligibility,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,location,sector,role,experience,languages,eligibility,details]);
      }
      if(interest==='job_check'){
        const checkType=clean(fields.check_type,32),market=clean(fields.candidate_market,20),paidReview=fields.request_paid_review===true||fields.request_paid_review==='yes',employer=clean(fields.claimed_employer,180),agency=clean(fields.claimed_agency,180)||null,jobTitle=clean(fields.job_title,160)||null,workLocation=clean(fields.work_location,160)||null,appointmentDate=clean(fields.appointment_date,10)||null,claimedStatus=clean(fields.claimed_status,100),referenceLast4=clean(fields.reference_last4,4)||null,evidence=clean(fields.evidence_description,2500);
        if(!['local','international'].includes(market)||!['job_offer','work_permit','consular_appointment','invitation_letter','recruitment_agent'].includes(checkType)||!employer||!claimedStatus||evidence.length<20||(referenceLast4&&!/^[A-Za-z0-9]{4}$/.test(referenceLast4))||(appointmentDate&&!/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate)))throw Object.assign(new Error('Complete the verification request details. Only the last four characters of a reference may be provided.'),{status:422});
        await client.query('INSERT INTO job_checks(id,check_type,candidate_market,paid_review_requested,claimed_employer,claimed_agency,job_title,work_location,appointment_date,claimed_status,reference_last4,evidence_description) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[id,checkType,market,paidReview,employer,agency,jobTitle,workLocation,appointmentDate,claimedStatus,referenceLast4,evidence]);
      }
      if(interest==='job_subscription'){
        const market=clean(fields.candidate_market,20),sectors=clean(fields.preferred_sectors,300),locations=clean(fields.preferred_locations,300)||null,roles=clean(fields.preferred_roles,300)||null,eligibility=clean(fields.work_authorisation,80)||null,frequency=clean(fields.frequency,20)||'weekly';
        if(!['local','international','both'].includes(market)||!sectors||!['immediate','weekly'].includes(frequency))throw Object.assign(new Error('Choose your job market, at least one sector and alert frequency.'),{status:422});
        await client.query('INSERT INTO job_subscriptions(id,candidate_market,preferred_sectors,preferred_locations,preferred_roles,work_authorisation,frequency) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,market,sectors,locations,roles,eligibility,frequency]);
      }
      if(interest==='recruitment_partner'){
        const agency=clean(fields.agency_name,180),jurisdiction=clean(fields.jurisdiction,120),licence=clean(fields.licence_status,30),licenceRef=clean(fields.licence_reference,160)||null,website=clean(fields.website,240)||null,regions=clean(fields.service_regions,240),specialisms=clean(fields.specialisms,500),feePolicy=clean(fields.candidate_fee_policy,40),compliance=fields.compliance_declaration===true||fields.compliance_declaration==='yes';
        if(!agency||!jurisdiction||!['licensed','applying','not_required','unsure'].includes(licence)||!regions||!specialisms||!['no_candidate_fees','other_or_unclear'].includes(feePolicy)||!compliance)throw Object.assign(new Error('Complete the agency details and compliance declaration.'),{status:422});
        await client.query('INSERT INTO recruitment_partners(id,agency_name,jurisdiction,licence_status,licence_reference,website,service_regions,specialisms,candidate_fee_policy,compliance_declaration) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,agency,jurisdiction,licence,licenceRef,website,regions,specialisms,feePolicy,compliance]);
      }
      if(interest==='employer_hiring'){
        const location=clean(fields.location,120),sector=clean(fields.sector,100),roles=clean(fields.roles,240),headcount=Number(fields.headcount),pay=clean(fields.pay,120)||null,timeline=clean(fields.timeline,60),requirements=clean(fields.details,2000);
        if(!location||!sector||!roles||!Number.isInteger(headcount)||headcount<1||headcount>5000||!timeline||requirements.length<10)throw Object.assign(new Error('Employer requirement is missing required structured fields.'),{status:422});
        await client.query('INSERT INTO employer_requirements(id,business_location,sector,roles,headcount,pay_range,hiring_timeline,requirements) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,location,sector,roles,headcount,pay,timeline,requirements]);
      }
      await client.query('COMMIT');
    } catch(error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    return json(res, 201, { ok:true, reference, status:'received', message:'Your enquiry has been received. Our team will review it.' });
  } catch (error) {
    console.error('Enquiry persistence failed:', error.code || error.name);
    return json(res, error.status||500, { error:error.status===422?error.message:'We could not save your enquiry. Please try again later.' });
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  if (process.env.NODE_ENV === 'production') res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !sameOrigin(req)) return json(res, 403, { error: 'Request origin rejected.' });
  const url = new URL(req.url || '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/health') {
    try {
      if (!pool) throw new Error('database_not_configured');
      await pool.query('SELECT 1');
      return json(res, 200, { ok:true, service:'ortakera-web', database:'connected' });
    } catch {
      return json(res, 503, { ok:false, service:'ortakera-web', database:'unavailable' });
    }
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/health') {
    try {
      if (!pool) throw new Error('database_not_configured');
      const result = await pool.query('SELECT NOW() AS database_time');
      return json(res, 200, { ok:true, api:'v1', database:'connected', databaseTime:result.rows[0].database_time });
    } catch {
      return json(res, 503, { ok:false, api:'v1', database:'unavailable' });
    }
  }
  if (url.pathname.startsWith('/api/v1/member/') || url.pathname.startsWith('/api/v1/employer/')) return handleMemberApi(req,res,url);
  if (url.pathname.startsWith('/api/v1/admin/')) return handleAdminApi(req,res,url);
  const applyMatch=url.pathname.match(/^\/api\/v1\/jobs\/([A-Z0-9-]+)\/apply$/i);
  if(req.method==='POST'&&applyMatch){
    const ip=(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').toString().split(',')[0].trim();
    if(!rateAllowed('apply:'+ip))return json(res,429,{error:'Too many applications from this connection. Try again later.'});
    let body;try{body=await readBody(req,2000)}catch(error){return json(res,error.status||400,{error:error.message})}
    const email=clean(body.email,254).toLowerCase(),candidateRef=clean(body.candidate_reference,40).toUpperCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!candidateRef)return json(res,422,{error:'Enter the email and candidate reference from your registration.'});
    try{const vacancy=await pool.query("SELECT id FROM vacancies WHERE reference_code=$1 AND status='published' AND employer_verified=TRUE AND legal_route_checked=TRUE",[applyMatch[1].toUpperCase()]);if(!vacancy.rowCount)return json(res,404,{error:'This opportunity is not available.'});const candidate=await pool.query("SELECT e.id FROM enquiries e JOIN candidate_profiles c ON c.id=e.id WHERE e.reference_code=$1 AND LOWER(e.email)=$2 AND e.interest='employment_candidate'",[candidateRef,email]);if(!candidate.rowCount)return json(res,404,{error:'Candidate registration could not be verified. Check your reference and email.'});const id=randomUUID();await pool.query("INSERT INTO job_applications(id,vacancy_id,candidate_enquiry_id) VALUES($1,$2,$3)",[id,vacancy.rows[0].id,candidate.rows[0].id]);return json(res,201,{ok:true,application_id:id,status:'received'});}catch(error){if(error.code==='23505')return json(res,409,{error:'You have already applied for this opportunity.'});console.error('Job application failed:',error.code||error.name);return json(res,500,{error:'Could not submit your application.'})}
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/jobs') {
    try { const result=await pool.query(`SELECT reference_code,title,sector,location,description,gross_pay_range,employment_type,headcount,created_at FROM vacancies WHERE status='published' AND employer_verified=TRUE AND legal_route_checked=TRUE ORDER BY created_at DESC LIMIT 100`); return json(res,200,{items:result.rows}); }
    catch { return json(res,500,{error:'Could not load published opportunities.'}); }
  }
  if (req.method === 'POST' && url.pathname === '/api/v1/enquiries') return handleEnquiry(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error:'Method not allowed' });

  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { return json(res, 400, { error:'Invalid URL path' }); }
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin') pathname = '/admin.html';
  if (pathname === '/employment') pathname = '/employment.html';
  if (pathname === '/account') pathname = '/account.html';
  const file = resolve(root, `.${pathname}`);
  if (file !== root && !file.startsWith(root + sep)) return json(res, 400, { error:'Invalid path' });
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type':mime[extname(file)] || 'application/octet-stream', 'x-content-type-options':'nosniff', 'cache-control':extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600' });
    return req.method === 'HEAD' ? res.end() : res.end(body);
  } catch {
    try {
      const body = await readFile(resolve(root, 'index.html'));
      res.writeHead(404, { 'content-type':'text/html; charset=utf-8', 'x-content-type-options':'nosniff' });
      return res.end(body);
    } catch { return json(res, 404, { error:'Not found' }); }
  }
});

server.listen(port, '0.0.0.0', async () => {
  console.log(`Ortakera server listening on ${port}`);
  if (pool) {
    try { await migrate(); console.log('Database schema ready'); }
    catch (error) { console.error('Database initialization failed:', error.code || error.name); }
  } else console.error('DATABASE_URL missing; enquiry persistence is disabled');
});

async function shutdown() {
  server.close(async () => {
    if (pool) await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

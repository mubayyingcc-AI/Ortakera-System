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
  const payload = Buffer.from(JSON.stringify({ email, exp: Math.floor(Date.now()/1000)+SESSION_TTL_SECONDS })).toString('base64url');
  return payload + '.' + sign(payload);
}
function readSession(req) {
  const secret = sessionSecret();
  if (!secret) return null;
  const token = cookieValue(req, SESSION_COOKIE);
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
    if (!data.email || !Number.isInteger(data.exp) || data.exp < Math.floor(Date.now()/1000)) return null;
    if (data.email !== (process.env.ADMIN_EMAIL || '').trim().toLowerCase()) return null;
    return data;
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
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
async function requireAdmin(req,res) {
  const session = readSession(req);
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
  setSessionCookie(res,createSession(adminEmail));
  return json(res,200,{ok:true,email:adminEmail,expiresIn:SESSION_TTL_SECONDS});
}
async function handleAdminApi(req,res,url) {
  if (req.method === 'POST' && url.pathname === '/api/v1/admin/login') return handleAdminLogin(req,res);
  if (req.method === 'POST' && url.pathname === '/api/v1/admin/logout') {
    if (!sameOrigin(req)) return json(res,403,{error:'Request origin rejected.'});
    clearSessionCookie(res); return json(res,200,{ok:true});
  }
  const admin = await requireAdmin(req,res);
  if (!admin) return;
  if (req.method === 'GET' && url.pathname === '/api/v1/admin/session') return json(res,200,{ok:true,email:admin.email});
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
  const vacancyMatch=url.pathname.match(/^\\/api\\/v1\\/admin\\/vacancies\\/([0-9a-f-]{36})$/i);
  if(req.method==='PATCH'&&vacancyMatch){
    if(!sameOrigin(req)) return json(res,403,{error:'Request origin rejected.'});
    let body;try{body=await readBody(req,3000)}catch(error){return json(res,error.status||400,{error:error.message})}
    const allowed=['draft','under_review','verified','published','closed','rejected'];
    if(!allowed.includes(body.status))return json(res,422,{error:'Invalid vacancy status.'});
    const current=await pool.query('SELECT * FROM vacancies WHERE id=$1',[vacancyMatch[1]]);
    if(!current.rowCount)return json(res,404,{error:'Vacancy not found.'});
    if(body.status==='published'&&(!current.rows[0].employer_verified||!current.rows[0].legal_route_checked))return json(res,422,{error:'Publishing is blocked until employer verification and legal-route review are both confirmed.'});
    const updated=await pool.query('UPDATE vacancies SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *',[body.status,vacancyMatch[1]]);
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
  const locale = ['en','tr','ar','fr','de'].includes(body.locale) ? body.locale : 'en';
  const consent = body.consent === true;
  const fields = body.fields && typeof body.fields === 'object' ? body.fields : {};
  const validInterests = ['business','partnership','capability','other','employment_candidate','employer_hiring'];

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
  if (url.pathname.startsWith('/api/v1/admin/')) return handleAdminApi(req,res,url);
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

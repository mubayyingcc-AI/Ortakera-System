import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
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
  const validInterests = ['business','partnership','capability','other'];

  if (name.length < 2) return json(res, 422, { error:'Please enter your name.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 422, { error:'Please enter a valid email address.' });
  if (!validInterests.includes(interest)) return json(res, 422, { error:'Please choose an enquiry category.' });
  if (message.length < 10) return json(res, 422, { error:'Please provide a little more detail (at least 10 characters).' });
  if (!consent) return json(res, 422, { error:'Consent is required before we can store this enquiry.' });

  const id = randomUUID();
  const reference = `ORT-${new Date().getUTCFullYear()}-${id.slice(0,8).toUpperCase()}`;
  try {
    await pool.query(
      `INSERT INTO enquiries (id, reference_code, name, email, organization, interest, message, locale, consent_at, consent_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),'privacy-notice-2026-10')`,
      [id, reference, name, email, organization, interest, message, locale]
    );
    return json(res, 201, { ok:true, reference, status:'received', message:'Your enquiry has been received. Our team will review it.' });
  } catch (error) {
    console.error('Enquiry persistence failed:', error.code || error.name);
    return json(res, 500, { error:'We could not save your enquiry. Please try again later.' });
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
  if (req.method === 'POST' && url.pathname === '/api/v1/enquiries') return handleEnquiry(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error:'Method not allowed' });

  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { return json(res, 400, { error:'Invalid URL path' }); }
  if (pathname === '/') pathname = '/index.html';
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

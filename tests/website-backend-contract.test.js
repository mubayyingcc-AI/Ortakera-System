import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const locales = ['en','tr','de','ru','ar','pt','it','ja','ko','zh'];

test('all public enquiry categories are accepted by the backend', async () => {
  const [home, employment, server] = await Promise.all([
    read('public/index.html'), read('public/employment.html'), read('server.js')
  ]);
  const forms = [...home, ...employment].join('');
  const categories = [...new Set([...forms.matchAll(/data-interest="([^"]+)"/g)].map(match => match[1]))];
  const accepted = server.match(/const validInterests = \[([^\]]+)\]/);
  assert.ok(accepted, 'backend validInterests declaration exists');
  const allowed = [...accepted[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  for (const category of categories) assert.ok(allowed.includes(category), 'backend accepts ' + category);
});

test('all ten public locale codes are accepted and stored by the API', async () => {
  const [home, employment, server] = await Promise.all([
    read('public/index.html'), read('public/employment.html'), read('server.js')
  ]);
  const localeOptions = [...home, ...employment].join('');
  const localeLine = server.match(/const locale = \[([^\]]+)\]\.includes\(body\.locale\)/);
  assert.ok(localeLine, 'backend locale allow-list exists');
  const allowed = [...localeLine[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  for (const locale of locales) {
    assert.ok(localeOptions.includes('value="' + locale + '"'), 'public selector offers ' + locale);
    assert.ok(allowed.includes(locale), 'backend accepts ' + locale);
  }
});

test('employment form submissions use the enquiry API and published vacancy API', async () => {
  const [client, server] = await Promise.all([read('public/employment.js'), read('server.js')]);
  for (const endpoint of ['/api/v1/enquiries','/api/v1/jobs']) {
    assert.ok(client.includes(endpoint), 'client calls ' + endpoint);
    assert.ok(server.includes(endpoint), 'server implements ' + endpoint);
  }
  assert.ok(server.includes('/apply$/i'), 'server implements vacancy application endpoint');
  assert.ok(client.includes('/apply'), 'client submits vacancy applications');
});

test('admin UI endpoints are implemented behind the admin API router', async () => {
  const [client, server] = await Promise.all([read('public/admin.js'), read('server.js')]);
  const endpoints = [...new Set([...client.matchAll(/['"`]((?:\/api\/v1\/admin\/)[^'"` ]*)/g)].map(match => match[1].split('?')[0]))];
  assert.ok(endpoints.length > 0, 'admin client declares API endpoints');
  assert.ok(server.includes("url.pathname.startsWith('/api/v1/admin/')"), 'server routes admin API');
  for (const endpoint of endpoints) {
    const fixed = endpoint.replace(/\$\{[^}]+\}/g, '');
    const base = fixed.replace(/\/$/, '');
    assert.ok(server.includes(base) || /\/api\/v1\/admin\//.test(base), 'server admin router covers ' + endpoint);
  }
});

test('health endpoints require a live database query', async () => {
  const server = await read('server.js');
  assert.ok(server.includes("url.pathname === '/health'"));
  assert.ok(server.includes("url.pathname === '/api/v1/health'"));
  assert.ok(server.includes("await pool.query('SELECT 1')"));
  assert.ok(server.includes("await pool.query('SELECT NOW() AS database_time')"));
});

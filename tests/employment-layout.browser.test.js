import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const root = resolve('public');
let server, browser, baseUrl;

before(async () => {
  server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\\/+/, '');
      const file = resolve(root, relative);
      if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
      const body = await readFile(file);
      const type = ({ '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp' })[extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'content-type': type });
      res.end(body);
    } catch { res.writeHead(404).end('Not found'); }
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  baseUrl = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  await new Promise(resolveClose => server?.close(resolveClose));
});

const formIds = ['candidateForm','employerForm','agencyForm','jobCheckForm','jobSubscriptionForm'];
for (const viewport of [{width:360,height:900},{width:390,height:844},{width:768,height:1024},{width:1280,height:900}]) {
  test('employment form final rows remain contained at ' + viewport.width + 'px', async () => {
    const page = await browser.newPage({ viewport });
    await page.route('https://fonts.googleapis.com/**', route => route.abort());
    await page.route('https://fonts.gstatic.com/**', route => route.abort());
    await page.goto(baseUrl + '/employment.html', { waitUntil: 'networkidle' });
    for (const id of formIds) {
      const form = page.locator('#' + id);
      assert.equal(await form.count(), 1, 'missing ' + id);
      const formBox = await form.boundingBox();
      assert.ok(formBox && formBox.width > 0, id + ' has no visible layout box');
      const controls = form.locator('label.consent-row, button[type="submit"], .form-foot, [aria-live="polite"]');
      const count = await controls.count();
      assert.ok(count >= 2, id + ' is missing final consent/submit/feedback controls');
      for (let i = 0; i < count; i++) {
        const control = controls.nth(i);
        const box = await control.boundingBox();
        if (!box) continue;
        assert.ok(box.x >= formBox.x - 1, id + ' final control starts outside its form');
        assert.ok(box.x + box.width <= formBox.x + formBox.width + 1, id + ' final control exceeds its form width');
        const span = control.locator('span').first();
        if (await span.count()) {
          const spanBox = await span.boundingBox();
          if (spanBox) assert.ok(spanBox.x + spanBox.width <= formBox.x + formBox.width + 1, id + ' consent text exceeds its form');
        }
      }
    }
    await page.close();
  });
}

test('long shared feedback toast stays inside narrow viewport', async () => {
  const page = await browser.newPage({ viewport: { width: 360, height: 800 } });
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.goto(baseUrl + '/employment.html', { waitUntil: 'networkidle' });
  const toast = page.locator('.toast').first();
  if (await toast.count()) {
    await toast.evaluate(el => {
      el.textContent = 'Submission received. ' + 'Please review your information and contact our support team if you need help. '.repeat(8);
      el.style.display = 'block';
      el.style.visibility = 'visible';
      el.style.opacity = '1';
      el.style.transform = 'translateX(-50%)';
    });
    const box = await toast.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 360, 'toast exceeds viewport width');
  }
  await page.close();
});

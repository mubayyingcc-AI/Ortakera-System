import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('employment layout protects navigation, grids and form controls at narrow widths', async () => {
 const [html,css,js]=await Promise.all([read('public/employment.html'),read('public/employment.css'),read('public/employment.js')]);
 assert.ok(html.includes('id="employmentMenuToggle"')&&html.includes('id="employmentNav"'));
 assert.ok(js.includes("employmentMenuToggle.addEventListener('click'"));
 assert.ok(css.includes('.employment-nav.is-open'));
 assert.ok(css.includes('.employment-form .consent-row input[type="checkbox"]{width:17px'));
 assert.ok(css.includes('.job-check-section form.employment-form{grid-column:2;grid-row:1 / span 2'));
 assert.ok(css.includes('@media(max-width:760px)'));
 assert.ok(css.includes('@media(max-width:440px)'));
});

test('employment section sequence is unique and links resolve to present sections', async () => {
 const html=await read('public/employment.html');
 for(const id of ['candidate','employer','job-alerts','job-check','agents','jobs','standards'])assert.ok(html.includes('id="'+id+'"'), 'missing section '+id);
 const numbers=[...html.matchAll(/class="kicker(?: light-kicker)?"><span>(\d{2})<\/span>/g)].map(x=>x[1]);
 assert.ok(numbers.length>=8);
 assert.deepEqual(numbers.slice(0,9),['01','02','03','04','05','06','07','08','09']);
});

test('employment page does not present live vacancies when none are confirmed', async () => {
 const html=await read('public/employment.html');
 assert.ok(html.includes('No live vacancies are currently confirmed.'));
 assert.ok(html.includes('No live vacancies listed on this page yet.'));
});

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
 assert.ok(html.includes('There are no live vacancies listed on this page yet.') || html.includes('No live vacancies are open at the moment.') || html.includes('There are no live vacancies currently confirmed.'));
});


test('employment form final rows and live feedback stay width-constrained', async () => {
 const [html,css,js]=await Promise.all([read('public/employment.html'),read('public/employment.css'),read('public/employment.js')]);
 const formIds=['candidateForm','employerForm','agencyForm','jobCheckForm','jobSubscriptionForm'];
 for (const id of formIds) {
  const start=html.indexOf('id="'+id+'"');
  assert.notEqual(start,-1,'missing form '+id);
  const end=html.indexOf('</form>',start);
  assert.ok(end>start,'form is not closed: '+id);
  const markup=html.slice(start,end);
  assert.match(markup,/class="consent-row"/,'missing consent row: '+id);
  assert.match(markup,/<button[^>]*type="submit"/,'missing submit button: '+id);
  assert.match(markup,/<p[^>]*aria-live="polite"/,'missing in-form live feedback: '+id);
 }
 assert.match(html,/<div class="toast" id="toast" role="status" aria-live="polite"><\/div>/);
 assert.match(css,/\.employment-form\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
 assert.match(css,/form\.employment-form\s+label\.consent-row\s*>\s*span\s*\{[^}]*min-width:\s*0\s*!important/s);
 assert.match(css,/form\.employment-form\s*>\s*p\.form-foot[^}]*overflow-wrap:\s*anywhere\s*!important/s);
 assert.match(css,/\.toast\s*\{[^}]*max-width:\s*calc\(100vw\s*-\s*32px\)/s);
 assert.match(css,/\.toast\s*\{[^}]*overflow-wrap:\s*anywhere/s);
 assert.ok(js.includes("notify(note.textContent)"),'submission feedback should use the bounded toast');
});

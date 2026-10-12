import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReadme, cell, istStamp } from '../scripts/render.mjs';

const row = (o) => ({ id: 'a:lever:1', company: 'Acme', company_slug: 'acme', role: 'SDE Intern', location: 'Pune', section: 'india', url: 'https://jobs/1', posted: '2026-10-10', batch: 'Any', stipend: null, source: 'lever', first_seen: '2026-10-10', ...o });
const meta = { updated_at: '2026-10-12T03:44:00.000Z', counts: { india: 1, remote: 0, abroad: 0, desk: 0, total: 1 } };

test('cell escapes pipes, newlines, and angle brackets', () => {
  assert.equal(cell('SDE | Intern\nBLR'), 'SDE \\| Intern BLR');
  assert.equal(cell('a <b> c'), 'a &lt;b&gt; c');
});

test('fix round 1, finding 10: cell escapes markdown link/emphasis specials so they render as plain text', () => {
  assert.equal(cell('Zepto [Free](https://phish.example)'), 'Zepto \\[Free\\]\\(https://phish.example\\)');
  assert.equal(cell('![](x)'), '\\!\\[\\]\\(x\\)');
  assert.equal(cell('*bold* _em_ `code`'), '\\*bold\\* \\_em\\_ \\`code\\`');
});

test('istStamp formats in IST', () => {
  assert.equal(istStamp('2026-10-12T03:44:00.000Z'), '12 Oct 2026, 09:14 IST');
});

test('README has header with updated phrase, sections, not stated stipend, age, and no em-dashes', () => {
  const md = renderReadme({ rows: [row({}), row({ id: 'b', company: 'Beta', section: 'remote', stipend: '₹40,000/month', url: 'https://jobs/2' })], closed: [{ ...row({ id: 'c', role: 'Old Intern' }), closed_at: '2026-10-11' }], desk: [{ company: 'Jane Street', role: 'SWE Intern', deadline: '2026-11-01', url: 'https://js/x', who: 'third years' }], meta });
  assert.match(md, /^# 🇮🇳 India Tech Internships 2027/m);
  assert.match(md, /Last updated: 12 Oct 2026, 09:14 IST/);
  assert.match(md, /⭐ Star to get updates/);
  assert.match(md, /## 🇮🇳 India-based/);
  assert.match(md, /## 🏠 Remote/);
  assert.match(md, /\| Acme \| SDE Intern \| Pune \| Any \| not stated \| \[Apply\]\(https:\/\/jobs\/1\) \| 2d \|/);
  assert.match(md, /₹40,000\/month/);
  assert.match(md, /~~Old Intern~~/);
  assert.match(md, /## 📌 Verified on the Deadline Desk/);
  assert.match(md, /Jane Street/);
  assert.doesNotMatch(md, /—/);
});

test('Apply links encode parentheses', () => {
  const md = renderReadme({ rows: [row({ url: 'https://x/job(1)' })], closed: [], desk: [], meta });
  assert.match(md, /\[Apply\]\(https:\/\/x\/job%281%29\)/);
});

test('fix round 1, finding 1: Apply links also encode pipe, space, angle brackets, quote and backtick', () => {
  const md = renderReadme({ rows: [row({ url: 'https://x/a|b c<d>e"f`g' })], closed: [], desk: [], meta });
  assert.match(md, /\[Apply\]\(https:\/\/x\/a%7Cb%20c%3Cd%3Ee%22f%60g\)/);
});

test('empty sections say so instead of rendering an empty table', () => {
  const md = renderReadme({ rows: [], closed: [], desk: [], meta: { ...meta, counts: { india: 0, remote: 0, abroad: 0, desk: 0, total: 0 } } });
  assert.match(md, /Nothing open here right now/);
});

test('stale rows are marked', () => {
  assert.match(renderReadme({ rows: [row({ stale: true })], closed: [], desk: [], meta }), /SDE Intern ⚠️/);
});

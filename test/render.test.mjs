import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReadme, cell, istStamp } from '../scripts/render.mjs';

const row = (o) => ({ id: 'a:lever:1', company: 'Acme', company_slug: 'acme', role: 'SDE Intern', location: 'Pune', section: 'india', url: 'https://jobs/1', posted: '2026-10-10', batch: 'Any', stipend: null, source: 'lever', first_seen: '2026-10-10', ...o });
const meta = { updated_at: '2026-10-12T03:44:00.000Z', counts: { india: 1, remote: 0, abroad: 0, desk: 0, total: 1 } };

test('cell escapes pipes and newlines', () => {
  assert.equal(cell('SDE | Intern\nBLR'), 'SDE \\| Intern BLR');
});

test('istStamp formats in IST', () => {
  assert.equal(istStamp('2026-10-12T03:44:00.000Z'), '12 Oct 2026, 09:14 IST');
});

test('README has header, sections, not stated stipend, age, and no em-dashes', () => {
  const md = renderReadme({ rows: [row({}), row({ id: 'b', company: 'Beta', section: 'remote', stipend: '₹40,000/month', url: 'https://jobs/2' })], closed: [{ ...row({ id: 'c', role: 'Old Intern' }), closed_at: '2026-10-11' }], desk: [{ company: 'Jane Street', role: 'SWE Intern', deadline: '2026-11-01', url: 'https://js/x', who: 'third years' }], meta });
  assert.match(md, /^# 🇮🇳 India Tech Internships 2027/m);
  assert.match(md, /Last updated: 12 Oct 2026, 09:14 IST/);
  assert.match(md, /## 🇮🇳 India-based/);
  assert.match(md, /## 🏠 Remote/);
  assert.match(md, /\| Acme \| SDE Intern \| Pune \| Any \| not stated \| \[Apply\]\(https:\/\/jobs\/1\) \| 2d \|/);
  assert.match(md, /₹40,000\/month/);
  assert.match(md, /~~Old Intern~~/);
  assert.match(md, /## 📌 Verified on the Deadline Desk/);
  assert.match(md, /Jane Street/);
  assert.doesNotMatch(md, /—/);
});

test('empty sections say so instead of rendering an empty table', () => {
  const md = renderReadme({ rows: [], closed: [], desk: [], meta: { ...meta, counts: { india: 0, remote: 0, abroad: 0, desk: 0, total: 0 } } });
  assert.match(md, /Nothing open here right now/);
});

test('stale rows are marked', () => {
  assert.match(renderReadme({ rows: [row({ stale: true })], closed: [], desk: [], meta }), /SDE Intern ⚠️/);
});

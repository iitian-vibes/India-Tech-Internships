import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReadme, cell, istStamp, careersUrlOf } from '../scripts/render.mjs';

const row = (o) => ({ id: 'a:lever:1', company: 'Acme', company_slug: 'acme', role: 'SDE Intern', location: 'Pune', section: 'india', url: 'https://jobs/1', posted: '2026-10-10', batch: 'Any', stipend: null, source: 'lever', first_seen: '2026-10-10', field: 'software-ai', ...o });
const meta = { updated_at: '2026-10-12T03:44:00.000Z', counts: { india: 1, remote: 0, abroad: 0, desk: 0, total: 1 } };
const lever = (slug) => ({ name: slug, slug, ats: 'lever', board: slug, abroad_visa: false });

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

test('careersUrlOf builds the right board URL per ats', () => {
  assert.equal(careersUrlOf({ ats: 'greenhouse', board: 'janestreet' }), 'https://job-boards.greenhouse.io/janestreet');
  assert.equal(careersUrlOf({ ats: 'lever', board: 'cred' }), 'https://jobs.lever.co/cred');
  assert.equal(careersUrlOf({ ats: 'ashby', board: 'sarvam' }), 'https://jobs.ashbyhq.com/sarvam');
  assert.equal(careersUrlOf({ ats: 'smartrecruiters', board: 'Swiggy' }), 'https://jobs.smartrecruiters.com/Swiggy');
  assert.equal(careersUrlOf({ ats: 'workday', workday: { host: 'nvidia.wd5.myworkdayjobs.com', site: 'NVIDIAExternalCareerSite' } }), 'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite');
  assert.equal(careersUrlOf(null), null);
});

test('README has header with updated intro, title, star line, and no em-dashes', () => {
  const md = renderReadme({ rows: [row({})], closed: [], desk: [], meta });
  assert.match(md, /^# 🇮🇳 India Tech Internships$/m);
  assert.match(md, /Prestigious internships for engineering students in India, every branch: software and AI, quant, core engineering and research\. Hand-picked companies, checked daily\./);
  assert.match(md, /Last updated: 12 Oct 2026, 09:14 IST/);
  assert.match(md, /⭐ Star to get updates/);
  assert.doesNotMatch(md, /—/);
});

test('section order: Software & AI, Quant, Core Engineering, Research', () => {
  const md = renderReadme({
    rows: [row({ id: 'sw', field: 'software-ai' }), row({ id: 'q', field: 'quant' }), row({ id: 'c', field: 'core' }), row({ id: 'r', field: 'research' })],
    closed: [], desk: [], meta,
  });
  const idx = (re) => md.search(re);
  const sw = idx(/## 💻 Software & AI/), qt = idx(/## 📈 Quant/), co = idx(/## ⚙️ Core Engineering/), rs = idx(/## 🔬 Research/);
  assert.ok(sw > -1 && qt > -1 && co > -1 && rs > -1, 'all four section headers present');
  assert.ok(sw < qt && qt < co && co < rs, `expected order sw<qt<co<rs, got ${JSON.stringify({ sw, qt, co, rs })}`);
});

test('table columns are Company, Role, Where, Apply, Age — no Batch or Stipend headers', () => {
  const md = renderReadme({ rows: [row({})], closed: [], desk: [], meta });
  assert.match(md, /\| Company \| Role \| Where \| Apply \| Age \|/);
  assert.doesNotMatch(md, /\| ?Batch ?\|/);
  assert.doesNotMatch(md, /\| ?Stipend ?\|/);
});

test('Where shows location plus (remote) or (abroad, visa) per section; plain for india', () => {
  const md = renderReadme({
    rows: [
      row({ id: 'i', company: 'IndiaCo', company_slug: 'indiaco', location: 'Pune', section: 'india' }),
      row({ id: 'r', company: 'RemoteCo', company_slug: 'remoteco', location: 'Remote - India', section: 'remote' }),
      row({ id: 'a', company: 'AbroadCo', company_slug: 'abroadco', location: 'Hong Kong', section: 'abroad' }),
    ],
    closed: [], desk: [], meta,
  });
  assert.match(md, /\| Pune \|/);
  assert.match(md, /\| Remote - India \\\(remote\\\) \|/);
  assert.match(md, /\| Hong Kong \\\(abroad, visa\\\) \|/);
});

test('inline stipend appears in the Role cell only when stated, nothing added when absent', () => {
  const md = renderReadme({
    rows: [row({ id: 'a', role: 'SDE Intern', stipend: '₹40,000/month' }), row({ id: 'b', company: 'Beta', company_slug: 'beta', role: 'ML Intern', stipend: null })],
    closed: [], desk: [], meta,
  });
  assert.match(md, /\| SDE Intern \\\(₹40,000\/month\\\) \|/);
  assert.match(md, /\| ML Intern \|/);
  assert.doesNotMatch(md, /not stated/);
});

test('desk rows merge into their field section, marked with a ✓ and "closes <date>"/"rolling" in Age', () => {
  const md = renderReadme({
    rows: [], closed: [],
    desk: [
      { company: 'Jane Street', role: 'SWE Intern', deadline: '2026-11-01', url: 'https://js/x', who: 'third years', field: 'software-ai', verified: true },
      { company: 'IMC Trading', role: 'Quant Trader Intern', deadline: null, url: 'https://imc/x', who: 'final years', field: 'quant', verified: true },
    ],
    meta,
  });
  assert.match(md, /## 💻 Software & AI[\s\S]*\| Jane Street \| SWE Intern ✓ \|.*\| \[Apply\]\(https:\/\/js\/x\) \| closes 2026-11-01 \|/);
  assert.match(md, /## 📈 Quant[\s\S]*\| IMC Trading \| Quant Trader Intern ✓ \|.*\| \[Apply\]\(https:\/\/imc\/x\) \| rolling \|/);
});

test('collapse: more than 3 rows from one company in a section collapse to 3 + "+N more at <Company>" linking to its careers page', () => {
  const rows = Array.from({ length: 5 }, (_, i) => row({ id: `n${i}`, company: 'NVIDIA', company_slug: 'nvidia', url: `https://nvidia/${i}`, posted: `2026-10-${10 - i}` }));
  const md = renderReadme({ rows, closed: [], desk: [], meta, companies: [{ name: 'NVIDIA', slug: 'nvidia', ats: 'workday', workday: { host: 'nvidia.wd5.myworkdayjobs.com', site: 'NVIDIAExternalCareerSite' }, abroad_visa: false }] });
  assert.match(md, /\+2 more at NVIDIA/);
  assert.match(md, /\[Careers\]\(https:\/\/nvidia\.wd5\.myworkdayjobs\.com\/en-US\/NVIDIAExternalCareerSite\)/);
  // exactly 3 kept rows + 1 collapse row for NVIDIA
  const nvidiaLines = md.split('\n').filter((l) => l.includes('NVIDIA'));
  assert.equal(nvidiaLines.length, 4);
});

test('collapse: 3 or fewer rows from one company are shown in full, no collapse row', () => {
  const rows = Array.from({ length: 3 }, (_, i) => row({ id: `n${i}`, company: 'Acme', company_slug: 'acme', url: `https://acme/${i}` }));
  const md = renderReadme({ rows, closed: [], desk: [], meta });
  assert.doesNotMatch(md, /more at Acme/);
});

test('empty sections say so instead of rendering an empty table', () => {
  const md = renderReadme({ rows: [], closed: [], desk: [], meta: { ...meta, counts: { india: 0, remote: 0, abroad: 0, desk: 0, total: 0 } } });
  assert.match(md, /Nothing open here right now/);
});

test('stale rows are marked', () => {
  assert.match(renderReadme({ rows: [row({ stale: true })], closed: [], desk: [], meta }), /SDE Intern ⚠️/);
});

test('fix round 2, finding 6 (carried forward): a desk deadline is escaped through cell(), not interpolated raw', () => {
  const md = renderReadme({
    rows: [], closed: [],
    desk: [{ company: 'Jane Street', role: 'SWE Intern', deadline: 'Rolling | [Click](https://phish.example)', url: 'https://js/x', who: 'third years', field: 'software-ai', verified: true }],
    meta,
  });
  // a raw deadline would inject a literal "|" and break the table into extra columns, and would render a clickable link
  assert.match(md, /closes Rolling \\\| \\\[Click\\\]\\\(https:\/\/phish\.example\\\)/);
});

test('Apply links encode parentheses', () => {
  const md = renderReadme({ rows: [row({ url: 'https://x/job(1)' })], closed: [], desk: [], meta });
  assert.match(md, /\[Apply\]\(https:\/\/x\/job%281%29\)/);
});

test('fix round 1, finding 1: Apply links also encode pipe, space, angle brackets, quote and backtick', () => {
  const md = renderReadme({ rows: [row({ url: 'https://x/a|b c<d>e"f`g' })], closed: [], desk: [], meta });
  assert.match(md, /\[Apply\]\(https:\/\/x\/a%7Cb%20c%3Cd%3Ee%22f%60g\)/);
});

test('recently-closed list is kept, with the escape-safe rendering it already had', () => {
  const md = renderReadme({ rows: [row({})], closed: [{ ...row({ id: 'c', role: 'Old Intern' }), closed_at: '2026-10-11' }], desk: [], meta });
  assert.match(md, /~~Old Intern~~/);
  assert.match(md, /## 🔒 Recently closed/);
});

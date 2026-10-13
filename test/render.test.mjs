import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReadme, cell, istStamp, careersUrlOf, jobKeyOf, dedupeDeskRows } from '../scripts/render.mjs';

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

// --- Fix round 1: dedupe Desk rows against bot/submitted rows by a normalised job key ---

test('jobKeyOf: identical URLs produce identical keys', () => {
  assert.equal(jobKeyOf('https://stripe.com/jobs/search?gh_jid=8031833'), jobKeyOf('https://stripe.com/jobs/search?gh_jid=8031833'));
});

test('jobKeyOf: host is lowercased and other query params are ignored', () => {
  const a = jobKeyOf('https://Stripe.com/jobs/search?gh_jid=8031833');
  const b = jobKeyOf('https://stripe.com/jobs/search?utm_source=desk&gh_jid=8031833');
  assert.equal(a, b);
});

test('jobKeyOf: a different gh_jid produces a different key', () => {
  assert.notEqual(jobKeyOf('https://stripe.com/jobs/search?gh_jid=1'), jobKeyOf('https://stripe.com/jobs/search?gh_jid=2'));
});

test('jobKeyOf: greenhouse /jobs/<id> path (Flow Traders real example) matches with no query param at all', () => {
  assert.equal(jobKeyOf('https://job-boards.greenhouse.io/flowtraders/jobs/8102618'), jobKeyOf('https://job-boards.greenhouse.io/flowtraders/jobs/8102618'));
});

test('jobKeyOf: a malformed URL returns null rather than throwing', () => {
  assert.equal(jobKeyOf('not a url'), null);
});

test('dedupeDeskRows: the three real duplicate examples (Stripe, Tower Research Capital, Flow Traders) each collapse to the bot row, desk-confirmed', () => {
  const others = [
    { id: 's1', company: 'Stripe', company_slug: 'stripe', role: 'Software Engineer, Intern', location: 'Bengaluru', section: 'india', url: 'https://stripe.com/jobs/search?gh_jid=8031833', posted: '2026-07-10', field: 'software-ai' },
    { id: 't1', company: 'Tower Research Capital', company_slug: 'tower-research-capital', role: 'Intern - AI/ML', location: 'Gurgaon', section: 'india', url: 'https://www.tower-research.com/open-positions/?gh_jid=8143756', posted: '2026-08-20', field: 'quant' },
    { id: 'f1', company: 'Flow Traders', company_slug: 'flow-traders', role: 'Trading Intern', location: 'Hong Kong', section: 'abroad', url: 'https://job-boards.greenhouse.io/flowtraders/jobs/8102618', posted: '2026-08-05', field: 'quant' },
  ];
  const desk = [
    { company: 'Stripe', role: 'Software Engineer, Intern: Bengaluru', deadline: null, url: 'https://stripe.com/jobs/search?gh_jid=8031833', who: '', field: 'software-ai', verified: true },
    { company: 'Tower Research Capital', role: 'Intern: AI/ML, Gurgaon (6 months from Jan 2027)', deadline: null, url: 'https://www.tower-research.com/open-positions/?gh_jid=8143756', who: '', field: 'software-ai', verified: true },
    { company: 'Flow Traders', role: 'Trading Intern: Hong Kong', deadline: '2026-11-15', url: 'https://job-boards.greenhouse.io/flowtraders/jobs/8102618', who: '', field: 'quant', verified: true },
  ];
  const r = dedupeDeskRows(desk, others);
  assert.equal(r.desk.length, 0, 'all three desk rows matched a bot row and were dropped');
  assert.equal(r.rows.find((x) => x.id === 's1').deskConfirmed, true);
  assert.equal(r.rows.find((x) => x.id === 't1').deskConfirmed, true);
  assert.equal(r.rows.find((x) => x.id === 'f1').deskConfirmed, true);
  assert.equal(r.rows.find((x) => x.id === 'f1').deskDeadline, '2026-11-15');
  // original bot location/section/field (and therefore section placement) are untouched
  assert.equal(r.rows.find((x) => x.id === 't1').field, 'quant');
  assert.equal(r.rows.find((x) => x.id === 't1').location, 'Gurgaon');
});

test('dedupeDeskRows: a desk row with no matching bot/submitted row is kept as-is', () => {
  const r = dedupeDeskRows([{ company: 'OIST', role: 'Research Internship', deadline: '2026-10-15', url: 'https://oist.jp/apply', who: '', field: 'research', verified: true }], []);
  assert.equal(r.desk.length, 1);
  assert.equal(r.rows.length, 0);
});

test('renderReadme integration: the three real duplicate examples render exactly once each, in the bot row\'s field, with the ✓ marker and closing date folded into Role', () => {
  const others = [
    { id: 's1', company: 'Stripe', company_slug: 'stripe', role: 'Software Engineer, Intern', location: 'Bengaluru', section: 'india', url: 'https://stripe.com/jobs/search?gh_jid=8031833', posted: '2026-07-10', batch: 'Any', stipend: null, source: 'greenhouse', first_seen: '2026-07-10', field: 'software-ai' },
    { id: 't1', company: 'Tower Research Capital', company_slug: 'tower-research-capital', role: 'Intern - AI/ML', location: 'Gurgaon', section: 'india', url: 'https://www.tower-research.com/open-positions/?gh_jid=8143756', posted: '2026-08-20', batch: 'Any', stipend: null, source: 'greenhouse', first_seen: '2026-08-20', field: 'quant' },
    { id: 'f1', company: 'Flow Traders', company_slug: 'flow-traders', role: 'Trading Intern', location: 'Hong Kong', section: 'abroad', url: 'https://job-boards.greenhouse.io/flowtraders/jobs/8102618', posted: '2026-08-05', batch: 'Any', stipend: null, source: 'greenhouse', first_seen: '2026-08-05', field: 'quant' },
  ];
  const desk = [
    { company: 'Stripe', role: 'Software Engineer, Intern: Bengaluru', deadline: null, url: 'https://stripe.com/jobs/search?gh_jid=8031833', who: '', field: 'software-ai', verified: true },
    { company: 'Tower Research Capital', role: 'Intern: AI/ML, Gurgaon (6 months from Jan 2027)', deadline: null, url: 'https://www.tower-research.com/open-positions/?gh_jid=8143756', who: '', field: 'software-ai', verified: true },
    { company: 'Flow Traders', role: 'Trading Intern: Hong Kong', deadline: '2026-11-15', url: 'https://job-boards.greenhouse.io/flowtraders/jobs/8102618', who: '', field: 'quant', verified: true },
  ];
  const md = renderReadme({ rows: others, closed: [], desk, meta });
  // one Stripe row, not two, and it shows the bot's own location (not blank)
  assert.equal((md.match(/\| Stripe \|/g) ?? []).length, 1);
  assert.match(md, /\| Stripe \| Software Engineer, Intern ✓ \| Bengaluru \| \[Apply\]\(https:\/\/stripe\.com\/jobs\/search\?gh_jid=8031833\) \| \d+d \|/);
  // Tower's row appears once, under Quant (the bot row's field), not under Software & AI (the desk row's field)
  assert.equal((md.match(/\| Tower Research Capital \|/g) ?? []).length, 1);
  const softwareAiSection = md.slice(md.indexOf('## 💻 Software & AI'), md.indexOf('## 📈 Quant'));
  const quantSection = md.slice(md.indexOf('## 📈 Quant'), md.indexOf('## ⚙️ Core Engineering'));
  assert.match(quantSection, /Tower Research Capital/);
  assert.doesNotMatch(softwareAiSection, /Tower Research Capital/);
  // Flow Traders appears once, with the desk's closing date folded into the Role cell
  assert.equal((md.match(/\| Flow Traders \|/g) ?? []).length, 1);
  assert.match(md, /\| Flow Traders \| Trading Intern ✓ \\\(closes 15 Nov\\\) \| Hong Kong \\\(abroad, visa\\\) \| \[Apply\]\(https:\/\/job-boards\.greenhouse\.io\/flowtraders\/jobs\/8102618\) \| \d+d \|/);
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

test('desk rows merge into their field section, marked with a ✓, "closes D Mon"/"open" in Age, and a derived Where', () => {
  const md = renderReadme({
    rows: [], closed: [],
    desk: [
      { company: 'Jane Street', role: 'SWE Intern: Hong Kong', deadline: '2026-11-01', url: 'https://js/x', who: 'third years', field: 'software-ai', verified: true },
      { company: 'IMC Trading', role: 'Quant Trader Intern', deadline: null, url: 'https://imc/x', who: 'final years', field: 'quant', verified: true },
    ],
    meta,
  });
  assert.match(md, /## 💻 Software & AI[\s\S]*\| Jane Street \| SWE Intern: Hong Kong ✓ \| Hong Kong \| \[Apply\]\(https:\/\/js\/x\) \| closes 1 Nov \|/);
  assert.match(md, /## 📈 Quant[\s\S]*\| IMC Trading \| Quant Trader Intern ✓ \| See posting \| \[Apply\]\(https:\/\/imc\/x\) \| open \|/);
});

test('Desk-row Where derivation: India cities and the extra global-hub vocabulary, falling back to "See posting"', () => {
  const d = (company, role) => ({ company, role, deadline: null, url: `https://x/${company}`, who: '', field: 'software-ai', verified: true });
  const md = renderReadme({
    rows: [], closed: [],
    desk: [d('A', 'Intern: AI/ML, Gurgaon'), d('B', 'Grad: Singapore'), d('C', 'Grad: Amsterdam'), d('D', 'Grad: Aarhus'), d('E', 'Nothing to go on')],
    meta,
  });
  assert.match(md, /\| Intern: AI\/ML, Gurgaon ✓ \| Gurgaon \|/);
  assert.match(md, /\| Grad: Singapore ✓ \| Singapore \|/);
  assert.match(md, /\| Grad: Amsterdam ✓ \| Amsterdam \|/);
  assert.match(md, /\| Grad: Aarhus ✓ \| Aarhus \|/);
  assert.match(md, /\| Nothing to go on ✓ \| See posting \|/);
});

test('collapse: only 5+ rows from one company in a section collapse (show 3, "+N more", N at least 2)', () => {
  const rows = Array.from({ length: 5 }, (_, i) => row({ id: `n${i}`, company: 'NVIDIA', company_slug: 'nvidia', url: `https://nvidia/${i}`, posted: `2026-10-${10 - i}` }));
  const md = renderReadme({ rows, closed: [], desk: [], meta, companies: [{ name: 'NVIDIA', slug: 'nvidia', ats: 'workday', workday: { host: 'nvidia.wd5.myworkdayjobs.com', site: 'NVIDIAExternalCareerSite' }, abroad_visa: false }] });
  assert.match(md, /\+2 more at NVIDIA/);
  assert.match(md, /\[Careers\]\(https:\/\/nvidia\.wd5\.myworkdayjobs\.com\/en-US\/NVIDIAExternalCareerSite\)/);
  // exactly 3 kept rows + 1 collapse row for NVIDIA
  const nvidiaLines = md.split('\n').filter((l) => l.includes('NVIDIA'));
  assert.equal(nvidiaLines.length, 4);
});

test('collapse: exactly 4 rows from one company are shown in full, no collapse row (threshold is 5+)', () => {
  const rows = Array.from({ length: 4 }, (_, i) => row({ id: `n${i}`, company: 'Acme', company_slug: 'acme', url: `https://acme/${i}` }));
  const md = renderReadme({ rows, closed: [], desk: [], meta });
  assert.doesNotMatch(md, /more at Acme/);
  const acmeLines = md.split('\n').filter((l) => l.includes('Acme'));
  assert.equal(acmeLines.length, 4);
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

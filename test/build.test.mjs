import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBuild, planWrites, chooseDesk, filterDeskRows } from '../scripts/build-core.mjs';

const C = (slug, ats = 'lever') => ({ name: slug.toUpperCase(), slug, ats, board: slug, abroad_visa: false });
const J = (id, title = 'SDE Intern') => ({ jobId: id, title, locations: ['Pune'], remote: false, url: `https://jobs/${id}`, posted: '2026-10-10T00:00:00Z', text: '', employmentType: '', stipendHint: null });
const base = { prevClosed: [], prevMeta: {}, today: '2026-10-12', now: new Date('2026-10-12T04:00:00Z'), desk: [], submitted: [], force: false };
const fetchers = (map) => ({ lever: async (c) => { const v = map[c.slug]; if (v instanceof Error) throw v; return v; } });

test('lists filtered jobs and counts them', async () => {
  const r = await runBuild({ ...base, companies: [C('a')], prev: [], fetchers: fetchers({ a: [J('1'), J('2', 'Senior Engineer')] }) });
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows.map((x) => x.id), ['a:lever:1']);
  assert.equal(r.meta.counts.india, 1);
});

test('a failing company keeps yesterday rows marked stale; others update', async () => {
  const prev = [{ id: 'a:lever:1', company: 'A', company_slug: 'a', role: 'SDE Intern', location: 'Pune', section: 'india', url: 'https://jobs/1', posted: '2026-10-01', batch: 'Any', stipend: null, source: 'lever', first_seen: '2026-10-01' }];
  const cs = [C('a'), C('b'), C('c'), C('d'), C('e'), C('f')];
  const r = await runBuild({ ...base, companies: cs, prev, fetchers: fetchers({ a: new Error('HTTP 500'), b: [J('9')], c: [], d: [], e: [], f: [] }) });
  assert.equal(r.ok, true);
  assert.equal(r.rows.find((x) => x.id === 'a:lever:1').stale, true);
  assert.ok(r.rows.find((x) => x.id === 'b:lever:9'));
  assert.deepEqual(r.meta.companies_failed, ['a']);
});

test('a company that had jobs yesterday and returns none today counts as failed', async () => {
  const prev = [{ id: 'a:lever:1', company: 'A', company_slug: 'a', role: 'SDE Intern', location: 'Pune', section: 'india', url: 'https://jobs/1', posted: null, batch: 'Any', stipend: null, source: 'lever', first_seen: '2026-10-01' }];
  const r = await runBuild({ ...base, companies: [C('a'), C('b'), C('c'), C('d'), C('e'), C('f')], prev, prevMeta: { jobs_by_company: { a: 12 } }, fetchers: fetchers({ a: [], b: [], c: [], d: [], e: [], f: [] }) });
  assert.equal(r.rows.find((x) => x.id === 'a:lever:1').stale, true);
  assert.deepEqual(r.meta.companies_failed, ['a']);
});

test('circuit breaker: more than 20% of companies failing writes nothing', async () => {
  const r = await runBuild({ ...base, companies: [C('a'), C('b'), C('c'), C('d')], prev: [], fetchers: fetchers({ a: new Error('x'), b: [], c: [], d: [] }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'circuit');
});

test('shrink guard: dropping over 30% of at least 20 rows writes nothing unless forced', async () => {
  const prev = Array.from({ length: 20 }, (_, i) => ({ id: `a:lever:${i}`, company: 'A', company_slug: 'a', role: 'SDE Intern', location: 'Pune', section: 'india', url: `https://jobs/${i}`, posted: null, batch: 'Any', stipend: null, source: 'lever', first_seen: '2026-10-01' }));
  const keep = Array.from({ length: 10 }, (_, i) => J(String(i)));
  const r = await runBuild({ ...base, companies: [C('a')], prev, fetchers: fetchers({ a: keep }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'shrink');
  const forced = await runBuild({ ...base, force: true, companies: [C('a')], prev, fetchers: fetchers({ a: keep }) });
  assert.equal(forced.ok, true);
  assert.equal(forced.closed.length, 10);
});

test('closed rows carry closed_at and are pruned after 7 days; first_seen survives', async () => {
  const prev = [{ id: 'a:lever:1', company: 'A', company_slug: 'a', role: 'SDE Intern', location: 'Pune', section: 'india', url: 'https://jobs/1', posted: null, batch: 'Any', stipend: null, source: 'lever', first_seen: '2026-09-01' }, { id: 'a:lever:2', company: 'A', company_slug: 'a', role: 'Data Intern', location: 'Pune', section: 'india', url: 'https://jobs/2', posted: null, batch: 'Any', stipend: null, source: 'lever', first_seen: '2026-09-01' }];
  const prevClosed = [{ id: 'old', closed_at: '2026-10-01' }, { id: 'recent', closed_at: '2026-10-08' }];
  const r = await runBuild({ ...base, companies: [C('a')], prev, prevClosed, fetchers: fetchers({ a: [J('2', 'Data Intern')] }) });
  assert.equal(r.rows[0].first_seen, '2026-09-01');
  assert.deepEqual(r.closed.map((x) => [x.id, x.closed_at]).sort(), [['a:lever:1', '2026-10-12'], ['recent', '2026-10-08']]);
});

test('duplicate URLs across companies collapse to one row', async () => {
  const r = await runBuild({ ...base, companies: [C('a'), C('b')], prev: [], fetchers: fetchers({ a: [J('1')], b: [{ ...J('7'), url: 'https://jobs/1' }] }) });
  assert.equal(r.rows.length, 1);
});

test('approved submissions are included; desk rows are counted separately', async () => {
  const submitted = [{ id: 'z:submitted:42', company: 'Z', company_slug: 'z', role: 'ML Intern', location: 'Remote - India', section: 'remote', url: 'https://z/42', posted: '2026-10-11', batch: 'Any', stipend: null, source: 'submitted', first_seen: '2026-10-11', submitted_by: 'student1' }];
  const desk = [{ company: 'Jane Street', role: 'SWE Intern', deadline: null, url: 'https://janestreet.com/x', who: 'third years' }];
  const r = await runBuild({ ...base, companies: [C('a')], prev: [], submitted, desk, fetchers: fetchers({ a: [] }) });
  assert.ok(r.rows.find((x) => x.id === 'z:submitted:42'));
  assert.equal(r.meta.counts.desk, 1);
  assert.equal(r.meta.counts.total, 2);
});

test('a company failing twice in a row stays failed on day 2 (jobs_by_company must carry forward through a failure)', async () => {
  const companies = [C('a'), C('b'), C('c'), C('d'), C('e'), C('f')];

  // Day 0: 'a' has 2 jobs, others empty — establishes jobs_by_company.a = 2.
  const day0 = await runBuild({ ...base, companies, prev: [], fetchers: fetchers({ a: [J('1'), J('2')], b: [], c: [], d: [], e: [], f: [] }) });
  assert.equal(day0.ok, true);
  assert.equal(day0.meta.jobs_by_company.a, 2);

  // Day 1: 'a' returns [] — treated as failed/stale.
  const day1 = await runBuild({ ...base, companies, prev: day0.rows, prevMeta: day0.meta, fetchers: fetchers({ a: [], b: [], c: [], d: [], e: [], f: [] }) });
  assert.equal(day1.ok, true);
  assert.deepEqual(day1.meta.companies_failed, ['a']);
  assert.equal(day1.rows.find((x) => x.id === 'a:lever:1').stale, true);

  // Day 2, fed from day 1's own output: 'a' returns [] again. It must still read as failed,
  // not silently accepted as "0 jobs is fine now" because day 1 dropped it from jobs_by_company.
  const day2 = await runBuild({ ...base, companies, prev: day1.rows, prevMeta: day1.meta, fetchers: fetchers({ a: [], b: [], c: [], d: [], e: [], f: [] }) });
  assert.deepEqual(day2.meta.companies_failed, ['a']);
  assert.equal(day2.rows.find((x) => x.id === 'a:lever:1').stale, true);
  assert.equal(day2.closed.some((x) => x.id === 'a:lever:1'), false);
});

test('shrink guard triggers on rows removed, not net row count (10 removed + 10 added keeps the total but still blocks)', async () => {
  const prev = Array.from({ length: 20 }, (_, i) => ({ id: `a:lever:${i}`, company: 'A', company_slug: 'a', role: 'SDE Intern', location: 'Pune', section: 'india', url: `https://jobs/${i}`, posted: null, batch: 'Any', stipend: null, source: 'lever', first_seen: '2026-10-01' }));
  const kept = Array.from({ length: 10 }, (_, i) => J(String(i + 10))); // ids 10..19, matches 10 of prev's 20 rows
  const added = Array.from({ length: 10 }, (_, i) => J(String(i + 20))); // ids 20..29, brand new — net total stays 20
  const r = await runBuild({ ...base, companies: [C('a')], prev, fetchers: fetchers({ a: [...kept, ...added] }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'shrink');
});

// --- fix round 2, finding 4: chooseDesk never lets an upstream schema change silently empty the desk section ---

const deskRow = (n) => ({ company: `Co${n}`, role: 'SWE Intern', deadline: null, url: `https://x/${n}`, who: 'students' });

test('chooseDesk: fetch failed (null) with a non-empty previous desk keeps the previous rows and warns', () => {
  const prevDesk = [deskRow(1), deskRow(2)];
  const r = chooseDesk(null, prevDesk);
  assert.deepEqual(r.desk, prevDesk);
  assert.ok(r.warning, 'expected a warning string');
});

test('chooseDesk: fetch returned [] with a non-empty previous desk keeps the previous rows and warns (the upstream-schema-change case)', () => {
  const prevDesk = [deskRow(1)];
  const r = chooseDesk([], prevDesk);
  assert.deepEqual(r.desk, prevDesk);
  assert.ok(r.warning);
});

test('chooseDesk: fetch returned [] and previous desk was also [] — genuinely empty, no warning', () => {
  const r = chooseDesk([], []);
  assert.deepEqual(r.desk, []);
  assert.equal(r.warning, null);
});

test('chooseDesk: fetch returned real rows — used as-is, no warning, regardless of previous', () => {
  const fetched = [deskRow(3)];
  const r = chooseDesk(fetched, [deskRow(1)]);
  assert.deepEqual(r.desk, fetched);
  assert.equal(r.warning, null);
});

test('planWrites returns null on a blocked result (circuit/shrink) so nothing is written', () => {
  const blocked = { ok: false, reason: 'circuit', rows: [], closed: [], meta: {}, errors: [] };
  assert.equal(planWrites(blocked, { liveSubmitted: [], desk: [], dryRun: false }), null);
});

test('planWrites returns null on a dry run even when the result is ok', () => {
  const ok = { ok: true, rows: [], closed: [], meta: {}, errors: [] };
  assert.equal(planWrites(ok, { liveSubmitted: [], desk: [], dryRun: true }), null);
});

// --- fix round 2, finding 3: bounded concurrency ---

test('runBuild fetches companies with bounded concurrency: 10 companies at 50ms each finish in well under 500ms serial time', async () => {
  const companies = Array.from({ length: 10 }, (_, i) => C(`c${i}`));
  const fetchersConc = { lever: async (c) => { await new Promise((r) => setTimeout(r, 50)); return [J(`${c.slug}-1`)]; } };
  const start = Date.now();
  const r = await runBuild({ ...base, companies, prev: [], fetchers: fetchersConc });
  const elapsed = Date.now() - start;
  assert.equal(r.ok, true);
  assert.ok(elapsed < 500, `expected well under 500ms serial-equivalent, got ${elapsed}ms`);
});

test('runBuild output order matches companies.json input order regardless of fetch completion order', async () => {
  const companies = Array.from({ length: 10 }, (_, i) => C(`c${i}`));
  // deliberately make later companies finish first, to prove output order is NOT completion order
  const fetchersConc = { lever: async (c) => { const n = Number(c.slug.slice(1)); await new Promise((r) => setTimeout(r, (9 - n) * 5)); return [J(`${c.slug}-1`)]; } };
  const r = await runBuild({ ...base, companies, prev: [], fetchers: fetchersConc });
  assert.deepEqual(r.rows.map((x) => x.id), companies.map((c) => `${c.slug}:lever:${c.slug}-1`));
});

// --- Task A, item 3: Desk rows now also pull lane A-research internships/fellowships, and every
// desk row is tagged with a README field and carries `verified: true`. ---

const opp = (o) => ({ id: 'x', name: 'Some Research Internship', org: 'Some Org', lane: 'B-industry', what: '', eligibility: '', pay: '', status: 'ROLLING', deadline: null, apply_url: 'https://x/apply', sub: 'Software', kind: 'Internship', who: 'students', ...o });

test('filterDeskRows: B-industry Internship/Full-time + OPEN/ROLLING kept, as before', () => {
  const all = [
    opp({ id: 'a', kind: 'Internship', status: 'ROLLING' }),
    opp({ id: 'b', kind: 'Full-time', status: 'OPEN', deadline: '2026-11-01' }),
    opp({ id: 'c', kind: 'Scholarship', status: 'OPEN' }), // wrong kind
    opp({ id: 'd', kind: 'Internship', status: 'EXPECTED' }), // wrong status
  ];
  const rows = filterDeskRows(all);
  assert.deepEqual(rows.map((r) => r.url), ['https://x/apply', 'https://x/apply']);
  assert.equal(rows.length, 2);
});

test('filterDeskRows: lane A-research Internship/Fellowship, research-titled, OPEN/ROLLING only', () => {
  const all = [
    opp({ id: 'a', lane: 'A-research', kind: 'Internship', status: 'OPEN', name: 'OIST Research Internship', sub: 'International', deadline: '2026-10-15' }),
    opp({ id: 'b', lane: 'A-research', kind: 'Fellowship', status: 'ROLLING', name: 'ISTA Scientific Internship (year-round)', sub: 'International' }),
    opp({ id: 'c', lane: 'A-research', kind: 'Internship', status: 'EXPECTED', name: 'Max Planck CS Institutes Summer Internship', sub: 'International' }), // wrong status
    opp({ id: 'd', lane: 'A-research', kind: 'Internship', status: 'OPEN', name: 'Generic Fellowship Programme', what: 'A general leadership programme', sub: 'International' }), // no intern/internship/summer/research programme mention
  ];
  const rows = filterDeskRows(all);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.field === 'research'));
});

test('filterDeskRows: sub-to-field map for B-industry rows', () => {
  const all = [
    opp({ id: 'a', sub: 'Software' }), opp({ id: 'b', sub: 'ML/AI' }), opp({ id: 'c', sub: 'Quant' }),
    opp({ id: 'd', sub: 'Finance' }), opp({ id: 'e', sub: 'Core/Hardware' }),
  ];
  const rows = filterDeskRows(all);
  assert.deepEqual(rows.map((r) => r.field), ['software-ai', 'software-ai', 'quant', 'quant', 'core']);
});

test('filterDeskRows: every row carries verified:true and the OPEN-only deadline rule', () => {
  const all = [opp({ id: 'a', status: 'OPEN', deadline: '2026-11-01' }), opp({ id: 'b', status: 'ROLLING', deadline: '2026-11-01' })];
  const rows = filterDeskRows(all);
  assert.deepEqual(rows.map((r) => r.verified), [true, true]);
  assert.deepEqual(rows.map((r) => r.deadline), ['2026-11-01', null]);
});

test('planWrites bundles all five data files together on a successful, non-dry run', () => {
  const ok = { ok: true, rows: [{ id: 'x' }], closed: [{ id: 'c', closed_at: '2026-10-12' }], meta: { counts: {} } };
  const plan = planWrites(ok, { liveSubmitted: [{ id: 's' }], desk: [{ company: 'Jane Street' }], dryRun: false });
  assert.deepEqual(Object.keys(plan).sort(), ['data/closed.json', 'data/desk.json', 'data/internships.json', 'data/meta.json', 'data/submitted.json'].sort());
  assert.deepEqual(plan['data/submitted.json'], [{ id: 's' }]);
  assert.deepEqual(plan['data/internships.json'], ok.rows);
  assert.deepEqual(plan['data/closed.json'], ok.closed);
  assert.deepEqual(plan['data/meta.json'], ok.meta);
  assert.deepEqual(plan['data/desk.json'], [{ company: 'Jane Street' }]);
});

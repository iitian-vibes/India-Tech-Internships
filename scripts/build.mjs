import { readFileSync, writeFileSync } from 'node:fs';
import { runBuild, planWrites, chooseDesk, filterDeskRows } from './build-core.mjs';
import { renderReadme } from './render.mjs';
import { fetchGreenhouse } from './fetch/greenhouse.mjs';
import { fetchLever } from './fetch/lever.mjs';
import { fetchAshby } from './fetch/ashby.mjs';
import { fetchWorkday } from './fetch/workday.mjs';
import { fetchSmartRecruiters } from './fetch/smartrecruiters.mjs';
import { fetchJson } from './fetch/util.mjs';

const args = new Set(process.argv.slice(2));
const read = (f, d) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return d; } };
const write = (f, v) => writeFileSync(f, JSON.stringify(v, null, 2) + '\n');
const now = new Date();
const today = new Date(now.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10); // IST date

async function deskRows() {
  try {
    const all = await fetchJson('https://raw.githubusercontent.com/iitian-vibes/deadline-desk/main/data/opportunities.json');
    return filterDeskRows(all);
  } catch (e) { console.error(`desk fetch failed, keeping previous desk rows: ${e.message}`); return null; }
}

const companiesList = read('data/companies.json', []);
const prev = read('data/internships.json', []);
const prevClosed = read('data/closed.json', []);
const prevMeta = read('data/meta.json', {});
const submitted = read('data/submitted.json', []);
const prevDesk = read('data/desk.json', []);

if (args.has('--render-only')) {
  writeFileSync('README.md', renderReadme({ rows: [...prev.filter((r) => r.source !== 'submitted'), ...submitted], closed: prevClosed, desk: prevDesk, meta: prevMeta, companies: companiesList }));
  process.exit(0);
}

const { desk, warning: deskWarning } = chooseDesk(await deskRows(), prevDesk);
if (deskWarning) console.error(`DESK WARNING: ${deskWarning}`);

// Approved submissions are not on a job-board API, so check their links daily.
// Two consecutive 404/410 answers retire a row into closed.json; network errors never count.
const retired = [];
for (const s of submitted) {
  let status = 0;
  try { status = (await fetch(s.url, { redirect: 'follow', signal: AbortSignal.timeout(20000) })).status; } catch {}
  s.dead_count = status === 404 || status === 410 ? (s.dead_count ?? 0) + 1 : 0;
  if (s.dead_count >= 2) retired.push(s);
}
const liveSubmitted = submitted.filter((s) => !retired.includes(s));
prevClosed.push(...retired.map(({ dead_count, ...s }) => ({ ...s, closed_at: today })));

const r = await runBuild({
  companies: companiesList, prev, prevClosed, prevMeta,
  fetchers: { greenhouse: fetchGreenhouse, lever: fetchLever, ashby: fetchAshby, workday: fetchWorkday, smartrecruiters: fetchSmartRecruiters },
  today, now, desk, submitted: liveSubmitted, force: args.has('--force'), deskWarning,
});
for (const e of r.errors) console.error(`company failed: ${e.slug}: ${e.message}`);
if (!r.ok) { console.error(`BUILD BLOCKED: ${r.reason}. Nothing written.`); process.exit(1); }

const before = new Set(prev.map((x) => x.id)), after = new Set(r.rows.map((x) => x.id));
console.log(`rows ${prev.length} -> ${r.rows.length} (+${[...after].filter((i) => !before.has(i)).length}, -${[...before].filter((i) => !after.has(i)).length}); companies ok ${r.meta.companies_ok}, failed ${r.meta.companies_failed.length}`);

// All data files change together or not at all — a blocked run already exited above;
// a --dry-run plans nothing here either.
const plan = planWrites(r, { liveSubmitted, desk, dryRun: args.has('--dry-run') });
if (!plan) process.exit(0);
for (const [path, value] of Object.entries(plan)) write(path, value);
writeFileSync('README.md', renderReadme({ rows: r.rows, closed: r.closed, desk, meta: r.meta, companies: companiesList }));

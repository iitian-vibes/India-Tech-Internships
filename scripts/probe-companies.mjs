import { readFileSync } from 'node:fs';
import { fetchGreenhouse } from './fetch/greenhouse.mjs';
import { fetchLever } from './fetch/lever.mjs';
import { fetchAshby } from './fetch/ashby.mjs';
import { fetchWorkday } from './fetch/workday.mjs';
import { fetchSmartRecruiters } from './fetch/smartrecruiters.mjs';
import { toRow, isStudentRole } from './filter.mjs';

const F = { greenhouse: fetchGreenhouse, lever: fetchLever, ashby: fetchAshby, workday: fetchWorkday, smartrecruiters: fetchSmartRecruiters };
const list = JSON.parse(readFileSync(process.argv[2] ?? 'data/companies.json', 'utf8'));
let bad = 0;
for (const c of list) {
  const started = Date.now();
  try {
    const jobs = await F[c.ats](c, { wantDetail: (t) => isStudentRole(t, '') });
    const listed = jobs.map((j) => toRow(j, c, '2026-01-01')).filter(Boolean).length;
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`${c.slug.padEnd(28)} ${c.ats.padEnd(15)} OK ${jobs.length} jobs, ${listed} listed (${secs}s)`);
  } catch (e) {
    bad++;
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`${c.slug.padEnd(28)} ${c.ats.padEnd(15)} FAIL ${e.message} (${secs}s)`);
  }
  await new Promise((r) => setTimeout(r, 300));
}
process.exit(bad ? 1 : 0);

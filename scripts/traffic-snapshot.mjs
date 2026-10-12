// scripts/traffic-snapshot.mjs
// Daily traffic snapshot for the public repo. Run with the owner's `gh` auth:
//   node scripts/traffic-snapshot.mjs
// Writes data/history/<YYYY-MM-DD>.json (IST date).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const R = 'repos/iitian-vibes/India-Tech-Internships-2027';
const gh = (p) => JSON.parse(execFileSync('gh', ['api', p], { encoding: 'utf8' }));
const date = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

const snap = {
  date,
  stars: gh(R).stargazers_count,
  views: gh(`${R}/traffic/views`),
  clones: gh(`${R}/traffic/clones`),
  referrers: gh(`${R}/traffic/popular/referrers`),
  paths: gh(`${R}/traffic/popular/paths`),
};

mkdirSync('data/history', { recursive: true });
writeFileSync(`data/history/${date}.json`, JSON.stringify(snap, null, 2) + '\n');
console.log(`stars ${snap.stars}, views ${snap.views.count}/${snap.views.uniques}`);

// scripts/traffic-snapshot.mjs
// Daily traffic snapshot for the public repo. Run with the owner's `gh` auth:
//   node scripts/traffic-snapshot.mjs
// Writes data/history/<YYYY-MM-DD>.json (IST date) — always, even on partial failure.
// Each `gh api` call is independent: one failing (rate limit, network blip, bad repo
// name) records `null` for that field plus an entry in `errors`, instead of losing
// the whole snapshot. Exit code is 0 if at least `stars` succeeded, 1 otherwise, so a
// caller can tell "degraded" from "useless".
//
// Override the target repo for testing: TRAFFIC_REPO=repos/<owner>/<bad-repo-name>
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const R = process.env.TRAFFIC_REPO || 'repos/iitian-vibes/India-Tech-Internships';
const gh = (p) => JSON.parse(execFileSync('gh', ['api', p], { encoding: 'utf8' }));
const date = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

const errors = [];
function safe(label, fn) {
  try {
    return fn();
  } catch (err) {
    errors.push(`${label}: ${String(err.message || err).split('\n')[0]}`);
    return null;
  }
}

const stars = safe('stars', () => gh(R).stargazers_count);
const views = safe('views', () => gh(`${R}/traffic/views`));
const clones = safe('clones', () => gh(`${R}/traffic/clones`));
const referrers = safe('referrers', () => gh(`${R}/traffic/popular/referrers`));
const paths = safe('paths', () => gh(`${R}/traffic/popular/paths`));

const snap = { date, stars, views, clones, referrers, paths, errors };

mkdirSync('data/history', { recursive: true });
writeFileSync(`data/history/${date}.json`, JSON.stringify(snap, null, 2) + '\n');

const starsStr = stars === null ? 'null' : String(stars);
const viewsStr = views ? `${views.count}/${views.uniques}` : 'null';
console.log(`stars ${starsStr}, views ${viewsStr}${errors.length ? ` (errors: ${errors.join('; ')})` : ''}`);

process.exit(stars === null ? 1 : 0);

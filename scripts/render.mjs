import { INDIA } from './filter.mjs';

const REPO = 'https://github.com/iitian-vibes/India-Tech-Internships';
const DESK = 'https://iitianvibes.com/blog/deadline-desk/?utm_source=github&utm_medium=readme&utm_campaign=india_tech_internships';
const GCAL = 'https://calendar.google.com/calendar/u/0/r/settings/addbyurl?cid=https%3A%2F%2Fiitianvibes.com%2Fblog%2Fdeadline-desk%2Fcalendar.ics';

// Fix round 1, finding 10: also backslash-escape markdown link/emphasis specials so a company or stipend like
// 'Zepto [Free](https://phish)' or '![](x)' renders as plain text instead of a clickable/embedded element.
export const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s*\r?\n\s*/g, ' ').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([[\]()!*_`])/g, '\\$1').trim();

// Fix round 1, finding 1: also percent-encode pipe, space, angle brackets, quote and backtick so a URL
// containing them (which `new URL()` does not reject) can never break out of the `[Apply](...)` markdown link.
export const encodeUrl = (url) => url.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\|/g, '%7C').replace(/ /g, '%20').replace(/</g, '%3C').replace(/>/g, '%3E').replace(/"/g, '%22').replace(/`/g, '%60');

export function istStamp(iso) {
  const d = new Date(Date.parse(iso) + 5.5 * 3600e3);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCDate()} ${mon} ${d.getUTCFullYear()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} IST`;
}

const age = (posted, nowIso) => (posted ? `${Math.max(0, Math.floor((Date.parse(nowIso) - Date.parse(posted + 'T00:00:00+05:30')) / 86400e3))}d` : '');

const byNewest = (a, b) => String(b.posted ?? b.first_seen ?? '').localeCompare(String(a.posted ?? a.first_seen ?? ''));

// Task A, item 4: the board URL each ATS serves its whole job list from, used for the collapse rule's
// "+N more at <Company>" link. Mirrors the exact URL templates scripts/fetch/*.mjs already builds
// per-posting URLs from, just rooted at the board/tenant instead of one job.
export function careersUrlOf(company) {
  if (!company) return null;
  switch (company.ats) {
    case 'greenhouse': return `https://${company.eu ? 'job-boards.eu.greenhouse.io' : 'job-boards.greenhouse.io'}/${company.board}`;
    case 'lever': return `https://jobs.lever.co/${company.board}`;
    case 'ashby': return `https://jobs.ashbyhq.com/${company.board}`;
    case 'smartrecruiters': return `https://jobs.smartrecruiters.com/${company.board}`;
    case 'workday': return company.workday ? `https://${company.workday.host}/en-US/${company.workday.site}` : null;
    default: return null;
  }
}

// Fix round 1: a Desk row's upstream feed carries no location field at all, only `company`/`role`. Rather
// than render blank, derive a city/country from the role text itself, reusing filter.mjs's exact India
// vocabulary (so it never drifts from what classifyLocation already considers "India") plus the other
// global hub cities these grad/intern postings name. Falls back to "See posting" when nothing is found —
// never guesses.
const OTHER_CITIES = /\b(hong kong|singapore|shanghai|sydney|melbourne|london|dublin|zurich|geneva|berlin|paris|amsterdam|aarhus|tokyo|dubai|toronto|austin|boston|seattle|san francisco|new york|chicago)\b/i;
function whereFromText(text = '') {
  const india = INDIA.exec(text);
  if (india) return india[0];
  const other = OTHER_CITIES.exec(text);
  if (other) return other[0];
  return 'See posting';
}

// "Where" column: plain location for an india-section row, with a suffix for remote/abroad. A desk
// (verified) row has no location field from the upstream feed, so it's derived from the role text instead.
function whereOf(r) {
  if (r.verified) return whereFromText(r.role);
  const suffix = r.section === 'remote' ? ' (remote)' : r.section === 'abroad' ? ' (abroad, visa)' : '';
  return `${r.location ?? ''}${suffix}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "D Mon" (e.g. "15 Oct"), not the raw ISO date — matches the compact style of every other date-ish cell
// in this table. Anything that isn't a clean YYYY-MM-DD (including upstream-feed injection attempts, see
// the cell()-escaping test below) is passed through unchanged rather than crashing.
function shortDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd ?? '');
  if (!m) return ymd;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}

function ageOf(r, nowIso) {
  if (r.verified) return r.deadline ? `closes ${shortDate(r.deadline)}` : 'open';
  return age(r.posted ?? r.first_seen, nowIso);
}

// Role cell carries the inline stipend (only when stated) plus the existing ⚠️ stale marker, the ✓
// desk-verified marker (pure desk rows), and — after Fix round 1's dedupe — a ✓ plus the Desk's closing
// date folded in for a bot/submitted row that turned out to also be on the Desk (deskConfirmed). The
// uncluttered design drops Batch and Stipend as their own columns entirely.
function roleCell(r) {
  let s = r.role;
  if (r.stipend) s += ` (${r.stipend})`;
  if (r.stale) s += ' ⚠️';
  if (r.verified) s += ' ✓';
  else if (r.deskConfirmed) s += r.deskDeadline ? ` ✓ (closes ${shortDate(r.deskDeadline)})` : ' ✓';
  return s;
}

// --- Fix round 1: dedupe Desk rows against bot/submitted rows ---
//
// The Desk and the bot/ATS fetchers independently discover the same live posting (Stripe, Tower Research
// Capital and Flow Traders all did this in the first live README). jobKeyOf is a normalised identity for a
// job posting URL: lowercase host + path, plus a job id pulled from whichever known ATS location actually
// carries one (greenhouse's `gh_jid` query param or `/jobs/<id>` path segment, lever/ashby's path UUID,
// workday's `_JR<id>` segment) — every other query param (utm_source, tracking, etc.) is ignored, so two
// URLs for the same job that differ only in tracking params still match.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
function extractJobId(url) {
  const ghJid = url.searchParams.get('gh_jid');
  if (ghJid) return `gh:${ghJid}`;
  const path = url.pathname;
  let m = /\/jobs\/(\d+)/i.exec(path); // greenhouse path form
  if (m) return `gh:${m[1]}`;
  m = UUID_RE.exec(path); // lever / ashby: /<company>/<uuid>
  if (m) return `uuid:${m[0].toLowerCase()}`;
  m = /_jr(\d+)/i.exec(path); // workday: ..._JR1234...
  if (m) return `jr:${m[1]}`;
  return null;
}

export function jobKeyOf(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return null; }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase().replace(/\/+$/, '');
  const id = extractJobId(url);
  return id ? `${host}${path}#${id}` : `${host}${path}`;
}

// Fix round 2, item 4: a shared job key alone is not enough — several research orgs (OIST, KAUST, ISTA...)
// run multiple distinct programmes behind one generic "apply here" URL, so matching on URL alone would
// collapse genuinely different opportunities into one. normalizeRole strips case/punctuation/whitespace
// noise; rolesMatch additionally allows containment either direction (a bot-fetched title is often a
// trimmed prefix of the Desk's fuller name, and vice versa — see the Stripe/Tower/Flow Traders examples).
function normalizeRole(s = '') {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function rolesMatch(a, b) {
  const na = normalizeRole(a), nb = normalizeRole(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

// Drops a Desk row only when BOTH its job key AND its (normalised) role title match a bot/submitted row,
// and instead annotates that matched row with `deskConfirmed`/`deskDeadline` (roleCell/ageOf above read
// those) — so the student sees ONE row, carrying the bot row's own location/age/field (and therefore its
// own section placement; a Desk row with a different `field` for the same job, like Tower Research
// Capital's ML/AI->software-ai vs the bot row's company-level quant, must not also render a second copy in
// that other section). A Desk row sharing a job key but naming a genuinely different role/programme is
// left in the kept list — distinct rows must never be dropped just because they share one apply URL.
export function dedupeDeskRows(desk, others) {
  const rows = others.map((r) => ({ ...r }));
  const rowsByKey = new Map();
  for (const r of rows) {
    const k = jobKeyOf(r.url);
    if (!k) continue;
    if (!rowsByKey.has(k)) rowsByKey.set(k, []);
    rowsByKey.get(k).push(r);
  }
  const keptDesk = [];
  for (const d of desk) {
    const k = jobKeyOf(d.url);
    const candidates = k ? (rowsByKey.get(k) ?? []) : [];
    const match = candidates.find((r) => rolesMatch(r.role, d.role));
    if (match) { match.deskConfirmed = true; match.deskDeadline = d.deadline ?? null; }
    else keptDesk.push(d);
  }
  return { desk: keptDesk, rows };
}

// Group rows by company, each group sorted newest-first internally, then groups ordered by their own
// newest row — so the table reads newest-first overall while every row from one company stays together
// (a prerequisite for the collapse rule below; scattering one company's rows across the table would make
// "more than 3 rows from one company" meaningless).
function groupByCompany(rows) {
  const byCompany = new Map();
  for (const r of rows) {
    if (!byCompany.has(r.company)) byCompany.set(r.company, []);
    byCompany.get(r.company).push(r);
  }
  const groups = [...byCompany.values()].map((g) => [...g].sort(byNewest));
  groups.sort((a, b) => byNewest(a[0], b[0]));
  return groups;
}

function table(rows, nowIso, companiesBySlug) {
  if (!rows.length) return '_Nothing open here right now. New roles are added every day._\n';
  const head = '| Company | Role | Where | Apply | Age |\n|---|---|---|---|---|\n';
  const lines = [];
  for (const group of groupByCompany(rows)) {
    // Fix round 1: collapse only kicks in at 5+ rows from one company (so the collapsed "+N more" always
    // hides at least 2), not 4+ — a company with exactly 4 live rows is still an uncluttered read in full.
    const shown = group.length >= 5 ? group.slice(0, 3) : group;
    for (const r of shown) {
      lines.push(`| ${cell(r.company)} | ${cell(roleCell(r))} | ${cell(whereOf(r))} | [Apply](${encodeUrl(r.url)}) | ${cell(ageOf(r, nowIso))} |`);
    }
    if (group.length >= 5) {
      const extra = group.length - 3;
      const known = companiesBySlug?.get(group[0].company_slug);
      const url = careersUrlOf(known) ?? group[0].url;
      lines.push(`| ${cell(group[0].company)} | +${extra} more at ${cell(group[0].company)} |  | [Careers](${encodeUrl(url)}) |  |`);
    }
  }
  return head + lines.join('\n') + '\n';
}

// README sections, in the fixed order the product rules specify: Software & AI, Quant, Core Engineering,
// Research. Replaces the old by-location (india/remote/abroad) sections now that "field" is the grouping;
// "Where" (location/remote/abroad) still shows per row, just as a column instead of a section.
const FIELDS = [
  ['software-ai', '💻 Software & AI'],
  ['quant', '📈 Quant'],
  ['core', '⚙️ Core Engineering'],
  ['research', '🔬 Research'],
];

export function renderReadme({ rows, closed, desk, meta, companies = [] }) {
  const c = meta.counts ?? { total: 0 };
  const companiesBySlug = new Map(companies.map((co) => [co.slug, co]));
  // Fix round 1: dedupe the Desk feed against bot/submitted rows BEFORE field-partitioning, so a job both
  // sources found renders once, under the bot/submitted row's own field (not the Desk's, which can differ —
  // see dedupeDeskRows above).
  const { desk: dedupedDesk, rows: dedupedRows } = dedupeDeskRows(desk, rows);
  // Desk rows are merged straight into their field's table (marked with a ✓ desk-verified role suffix
  // and "closes D Mon"/"open" in Age) instead of living in their own separate section.
  const sectionsMd = FIELDS.map(([key, heading]) => {
    const merged = [...dedupedRows.filter((r) => r.field === key), ...dedupedDesk.filter((d) => d.field === key)];
    return `## ${heading}\n\n${table(merged, meta.updated_at, companiesBySlug)}`;
  }).join('\n');
  const closedList = closed.length
    ? closed.map((r) => `- ~~${cell(r.role)}~~ at ${cell(r.company)} (closed ${r.closed_at})`).join('\n') + '\n'
    : '_None in the last 7 days._\n';
  return `<p align="center"><img src="assets/banner.png" alt="India Tech Internships: the internships worth having, every engineering branch" width="100%"></p>

# 🇮🇳 India Tech Internships

Prestigious internships for engineering students in India, every branch: software and AI, quant, core engineering and research. Hand-picked companies, checked daily.

**${c.total} open** · Last updated: ${meta.updated_at ? istStamp(meta.updated_at) : 'not yet'} · ⭐ Star to get updates

📅 [Add every deadline to Google Calendar](${GCAL}) · 🗂️ Scholarships, govt jobs, MBA and more: [the Deadline Desk](${DESK}) · ➕ [Submit an internship](${REPO}/issues/new?template=submit-internship.yml)

${sectionsMd}
## 🔒 Recently closed

${closedList}
---

✓ means hand-checked on the Deadline Desk, with the deadline quoted from the company's own page. ⚠️ means the company's job board did not answer today, so the row is from the last successful check. Spotted something wrong? [Open an issue](${REPO}/issues). Data: CC BY 4.0. Code: MIT. By [IITian Vibes](https://iitianvibes.com/?utm_source=github&utm_medium=readme).
`;
}

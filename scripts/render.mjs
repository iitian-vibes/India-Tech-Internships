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

// "Where" column: plain location for an india-section row, with a suffix for remote/abroad. A desk
// (verified) row carries no location data from the upstream feed at all, so it renders blank there —
// its own "closes <date>"/"rolling" marker in the Age column already carries the row's real signal.
function whereOf(r) {
  if (r.verified) return '';
  const suffix = r.section === 'remote' ? ' (remote)' : r.section === 'abroad' ? ' (abroad, visa)' : '';
  return `${r.location ?? ''}${suffix}`;
}

function ageOf(r, nowIso) {
  if (r.verified) return r.deadline ? `closes ${r.deadline}` : 'rolling';
  return age(r.posted ?? r.first_seen, nowIso);
}

// Role cell carries the inline stipend (only when stated) plus the existing ⚠️ stale marker and the new
// ✓ desk-verified marker — the uncluttered design drops Batch and Stipend as their own columns entirely.
function roleCell(r) {
  let s = r.role;
  if (r.stipend) s += ` (${r.stipend})`;
  if (r.stale) s += ' ⚠️';
  if (r.verified) s += ' ✓';
  return s;
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
    const shown = group.length > 3 ? group.slice(0, 3) : group;
    for (const r of shown) {
      lines.push(`| ${cell(r.company)} | ${cell(roleCell(r))} | ${cell(whereOf(r))} | [Apply](${encodeUrl(r.url)}) | ${cell(ageOf(r, nowIso))} |`);
    }
    if (group.length > 3) {
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
  // Desk rows are merged straight into their field's table (marked with a ✓ desk-verified role suffix
  // and "closes <date>"/"rolling" in Age) instead of living in their own separate section.
  const sectionsMd = FIELDS.map(([key, heading]) => {
    const merged = [...rows.filter((r) => r.field === key), ...desk.filter((d) => d.field === key)];
    return `## ${heading}\n\n${table(merged, meta.updated_at, companiesBySlug)}`;
  }).join('\n');
  const closedList = closed.length
    ? closed.map((r) => `- ~~${cell(r.role)}~~ at ${cell(r.company)} (closed ${r.closed_at})`).join('\n') + '\n'
    : '_None in the last 7 days._\n';
  return `# 🇮🇳 India Tech Internships

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

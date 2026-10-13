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

const byNewest = (a, b) => String(b.posted ?? b.first_seen).localeCompare(String(a.posted ?? a.first_seen));

function table(rows, nowIso) {
  if (!rows.length) return '_Nothing open here right now. New roles are added every day._\n';
  const head = '| Company | Role | Location | Batch | Stipend | Apply | Posted |\n|---|---|---|---|---|---|---|\n';
  return head + [...rows].sort(byNewest).map((r) => `| ${cell(r.company)} | ${cell(r.role)}${r.stale ? ' ⚠️' : ''} | ${cell(r.location)} | ${cell(r.batch)} | ${cell(r.stipend ?? 'not stated')} | [Apply](${encodeUrl(r.url)}) | ${age(r.posted ?? r.first_seen, nowIso)} |`).join('\n') + '\n';
}

export function renderReadme({ rows, closed, desk, meta }) {
  const c = meta.counts ?? { total: 0 };
  const sec = (s) => rows.filter((r) => r.section === s);
  // Fix round 2, finding 6: the deadline came from an upstream feed and was interpolated raw — wrap it in
  // cell() like every other user/upstream-controlled value in this table, so a "|" or markdown link/emphasis
  // special in it can't break the table structure or render as a clickable/embedded element.
  const deskTable = desk.length
    ? '| Company | Role | Closes | Who can apply | Apply |\n|---|---|---|---|---|\n' + desk.map((d) => `| ${cell(d.company)} | ${cell(d.role)} | ${cell(d.deadline ?? 'rolling')} | ${cell(d.who)} | [Apply](${encodeUrl(d.url)}) |`).join('\n') + '\n'
    : '_Nothing here right now._\n';
  const closedList = closed.length
    ? closed.map((r) => `- ~~${cell(r.role)}~~ at ${cell(r.company)} (closed ${r.closed_at})`).join('\n') + '\n'
    : '_None in the last 7 days._\n';
  return `# 🇮🇳 India Tech Internships

Tech internships you can actually apply to as a student in India: SWE, ML, data, quant and new-grad roles, based in India, remote, or abroad with visa sponsorship. Pulled every day from companies' own job boards and checked by hand on the Deadline Desk. Run by IITians, open to every student. Now tracking the 2027 season.

**${c.total} open** · Last updated: ${meta.updated_at ? istStamp(meta.updated_at) : 'not yet'} · ⭐ Star to get updates

📅 [Add every deadline to Google Calendar](${GCAL}) · 🗂️ Scholarships, govt jobs, MBA and more: [the Deadline Desk](${DESK}) · ➕ [Submit an internship](${REPO}/issues/new?template=submit-internship.yml)

## 🇮🇳 India-based

${table(sec('india'), meta.updated_at)}
## 🏠 Remote

${table(sec('remote'), meta.updated_at)}
## 🌏 Abroad (visa sponsored)

${table(sec('abroad'), meta.updated_at)}
## 📌 Verified on the Deadline Desk

Hand-checked roles with the deadline quoted from the company's own page.

${deskTable}
## 🔒 Recently closed

${closedList}
---

⚠️ means the company's job board did not answer today, so the row is from the last successful check. Stipend says "not stated" unless the posting itself names an amount. Spotted something wrong? [Open an issue](${REPO}/issues). Data: CC BY 4.0. Code: MIT. By [IITian Vibes](https://iitianvibes.com/?utm_source=github&utm_medium=readme).
`;
}

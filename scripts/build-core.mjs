import { toRow, isStudentRole } from './filter.mjs';

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);
const withTimeout = (p, ms) => {
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
};

export async function runBuild({ companies, prev, prevClosed, prevMeta = {}, fetchers, today, now, desk = [], submitted = [], force = false }) {
  const prevById = new Map(prev.map((r) => [r.id, r]));
  const errors = [];
  const failed = new Set();
  const jobsByCompany = {};
  const fresh = [];

  for (const c of companies) {
    try {
      const fetcher = fetchers[c.ats];
      if (!fetcher) throw new Error(`no fetcher for ${c.ats}`);
      const jobs = await withTimeout(fetcher(c, { wantDetail: (t) => isStudentRole(t, '') }), 60000);
      if (jobs.length === 0 && (prevMeta.jobs_by_company?.[c.slug] ?? 0) > 0) throw new Error('returned 0 jobs after returning some yesterday');
      jobsByCompany[c.slug] = jobs.length;
      for (const j of jobs) { const row = toRow(j, c, today); if (row) fresh.push(row); }
    } catch (e) {
      failed.add(c.slug);
      errors.push({ slug: c.slug, message: String(e.message ?? e) });
    }
  }

  if (companies.length && failed.size / companies.length > 0.2) {
    return { ok: false, reason: 'circuit', rows: prev, closed: prevClosed, meta: prevMeta, errors };
  }

  const seenUrl = new Set();
  const rows = [];
  const add = (r) => { if (seenUrl.has(r.url)) return; seenUrl.add(r.url); rows.push(r); };
  for (const r of fresh) add({ ...r, first_seen: prevById.get(r.id)?.first_seen ?? r.first_seen });
  for (const r of prev) if (failed.has(r.company_slug) && r.source !== 'submitted') add({ ...r, stale: true });
  for (const r of submitted) add(r);

  const liveIds = new Set(rows.map((r) => r.id));
  const newlyClosed = prev
    .filter((r) => r.source !== 'submitted' && !failed.has(r.company_slug) && !liveIds.has(r.id))
    .map((r) => { const { stale, ...rest } = r; return { ...rest, closed_at: today }; });
  const keptClosed = prevClosed.filter((r) => daysBetween(r.closed_at, today) <= 7 && !liveIds.has(r.id));
  const closed = [...newlyClosed, ...keptClosed.filter((r) => !newlyClosed.some((n) => n.id === r.id))];

  if (!force && prev.length >= 20 && rows.length < prev.length * 0.7) {
    return { ok: false, reason: 'shrink', rows: prev, closed: prevClosed, meta: prevMeta, errors };
  }

  const count = (s) => rows.filter((r) => r.section === s).length;
  const meta = {
    updated_at: now.toISOString(),
    counts: { india: count('india'), remote: count('remote'), abroad: count('abroad'), desk: desk.length, total: rows.length + desk.length },
    companies_ok: companies.length - failed.size, companies_failed: [...failed].sort(), jobs_by_company: jobsByCompany,
  };
  return { ok: true, rows, closed, meta, errors };
}

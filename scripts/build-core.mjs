import { toRow, isStudentRole } from './filter.mjs';

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);
const withTimeout = (p, ms) => {
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`timeout after ${ms}ms`)), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
};

// Fix round 2, finding 3: fetching 75+ companies strictly one-at-a-time (each with its own 60s timeout) can
// get nowhere near the daily.yml job's 30-minute wall clock budget if several of them are slow. runPool runs
// `worker` over `items` with at most `limit` in flight at once, but ALWAYS writes each result back into the
// slot matching that item's original index — so the returned array is in `items` order no matter which
// worker finishes first, keeping the build's output deterministic. No dependencies; just an index-based
// work queue shared by `limit` async loops.
async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runWorker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, runWorker);
  await Promise.all(workers);
  return results;
}

const COMPANY_CONCURRENCY = 6;

export async function runBuild({ companies, prev, prevClosed, prevMeta = {}, fetchers, today, now, desk = [], submitted = [], force = false, deskWarning = null }) {
  const prevById = new Map(prev.map((r) => [r.id, r]));
  const errors = [];
  const failed = new Set();
  const jobsByCompany = {};
  const fresh = [];

  // Per-company isolation: each slot resolves to either { ok: true, jobs } or { ok: false, slug, message } —
  // one company's failure can never throw out of its own worker and affect any other company's result.
  const outcomes = await runPool(companies, COMPANY_CONCURRENCY, async (c) => {
    try {
      const fetcher = fetchers[c.ats];
      if (!fetcher) throw new Error(`no fetcher for ${c.ats}`);
      const jobs = await withTimeout(fetcher(c, { wantDetail: (t) => isStudentRole(t, '') }), 60000);
      if (jobs.length === 0 && (prevMeta.jobs_by_company?.[c.slug] ?? 0) > 0) throw new Error('returned 0 jobs after returning some yesterday');
      return { ok: true, jobs };
    } catch (e) {
      return { ok: false, message: String(e.message ?? e) };
    }
  });

  // Rows are built from `outcomes` in `companies` order (outcomes[i] belongs to companies[i]), so the final
  // `fresh` array — and therefore the rendered README table order — is deterministic regardless of which
  // company's fetch happened to finish first.
  for (let i = 0; i < companies.length; i++) {
    const c = companies[i];
    const outcome = outcomes[i];
    if (outcome.ok) {
      jobsByCompany[c.slug] = outcome.jobs.length;
      for (const j of outcome.jobs) { const row = toRow(j, c, today); if (row) fresh.push(row); }
    } else {
      failed.add(c.slug);
      // Carry the previous day's count forward. Otherwise a company that fails on day N
      // drops out of jobs_by_company, so on day N+1 "returned 0 jobs" looks like business
      // as usual instead of a second failure, and its rows get closed instead of staying stale.
      jobsByCompany[c.slug] = prevMeta.jobs_by_company?.[c.slug] ?? 0;
      errors.push({ slug: c.slug, message: outcome.message });
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

  const removed = prev.filter((r) => !liveIds.has(r.id)).length;
  if (!force && prev.length >= 20 && removed > prev.length * 0.3) {
    return { ok: false, reason: 'shrink', rows: prev, closed: prevClosed, meta: prevMeta, errors };
  }

  const count = (s) => rows.filter((r) => r.section === s).length;
  const meta = {
    updated_at: now.toISOString(),
    counts: { india: count('india'), remote: count('remote'), abroad: count('abroad'), desk: desk.length, total: rows.length + desk.length },
    companies_ok: companies.length - failed.size, companies_failed: [...failed].sort(), jobs_by_company: jobsByCompany,
    // Fix round 2, finding 4: surfaced in data/meta.json so daily.yml's post-build check can fail the run
    // loudly (after the data commit) whenever chooseDesk() had to fall back to yesterday's desk rows.
    ...(deskWarning ? { desk_warning: deskWarning } : {}),
  };
  return { ok: true, rows, closed, meta, errors };
}

// Fix round 2, finding 4: build.mjs's deskRows() fetches the upstream deadline-desk feed and previously fell
// back to yesterday's rows ONLY on a thrown fetch error (`?? prevDesk`) — but an upstream schema change (a
// renamed field, a renamed lane/status/kind value) makes the SAME `.filter()` return `[]` without throwing at
// all, which silently emptied the "Verified on the Deadline Desk" README section with no signal anywhere.
// chooseDesk is the single pure decision: keep the previous desk + warn whenever the fetch failed outright
// (fetched === null) OR came back empty while we previously had real rows; otherwise use what was fetched.
export function chooseDesk(fetched, prevDesk) {
  if (fetched === null) {
    return { desk: prevDesk, warning: `desk fetch failed; kept ${prevDesk.length} previous row(s)` };
  }
  if (fetched.length === 0 && prevDesk.length > 0) {
    return { desk: prevDesk, warning: `desk fetch returned 0 rows (was ${prevDesk.length}); likely an upstream schema change — kept previous rows` };
  }
  return { desk: fetched, warning: null };
}

// Decides what gets written to disk for a completed runBuild() result. Returns null when
// there is nothing to write (a blocked run, or a --dry-run) so every data file either changes
// together or not at all — a blocked/dry run must never leave submitted.json out of step with
// internships.json/closed.json.
export function planWrites(result, { liveSubmitted, desk, dryRun = false } = {}) {
  if (!result.ok || dryRun) return null;
  return {
    'data/internships.json': result.rows,
    'data/closed.json': result.closed,
    'data/meta.json': result.meta,
    'data/desk.json': desk,
    'data/submitted.json': liveSubmitted,
  };
}

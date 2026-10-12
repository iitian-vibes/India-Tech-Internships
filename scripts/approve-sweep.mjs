import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseIssueForm, validateSubmission, submissionRow, fetchPosting } from './submission.mjs';
import { renderReadme } from './render.mjs';

const MANIFEST_PATH = '.sweep-result.json';

// --- pure, testable decision logic ---

// Fix round 1, finding 3: has the issue been edited (body or title) or updated after the LATEST
// 'checks-passed' labelling? If so the checks that ran no longer describe what's actually in the issue.
export function editedAfterChecks(events = [], issueUpdatedAt = null) {
  const checksEvents = events.filter((e) => e.event === 'labeled' && e.label?.name === 'checks-passed');
  if (!checksEvents.length) return true; // no record of checks ever passing -> treat as unsafe
  const checksTime = Math.max(...checksEvents.map((e) => Date.parse(e.created_at)));
  const laterTimelineEvent = events.some((e) => (e.event === 'edited' || e.event === 'renamed') && Date.parse(e.created_at) > checksTime);
  const laterIssueUpdate = issueUpdatedAt ? Date.parse(issueUpdatedAt) > checksTime : false;
  return laterTimelineEvent || laterIssueUpdate;
}

export function hasIssueNumber(rows, issueNumber) {
  return rows.some((r) => String(r.id).endsWith(`:submitted:${issueNumber}`));
}

// Fix round 1, findings 4 & 5: idempotent merge, an issue number already present in `existingSubmitted`
// (from an earlier sweep run) is skipped rather than appended again.
export function mergeApprovedRows(existingSubmitted, candidates) {
  const rows = [...existingSubmitted];
  const added = [];
  const skipped = [];
  for (const c of candidates) {
    if (hasIssueNumber(rows, c.issueNumber)) { skipped.push(c.issueNumber); continue; }
    rows.push(c.row);
    added.push(c.issueNumber);
  }
  return { rows, added, skipped };
}

// --- GitHub API orchestration (not unit tested; exercised by the live e2e run) ---

const { GITHUB_REPOSITORY, GH_TOKEN } = process.env;
const api = (path, init = {}) => fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`, { ...init, headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', ...(init.headers ?? {}) } });

async function listCandidateIssues() {
  const res = await api('/issues?state=open&labels=approved,checks-passed&per_page=100');
  const json = await res.json();
  return Array.isArray(json) ? json : [];
}

async function fetchTimeline(n) {
  const res = await api(`/issues/${n}/timeline`);
  const json = await res.json();
  return Array.isArray(json) ? json : null;
}

// The issue's body-edit timestamp. Deliberately NOT the REST issue.updated_at field: that field is bumped by
// every labeled/unlabeled event too (including the sweep's own relabelling and the 'approved' label itself),
// so using it produced a false positive on every approval in this fix's own live e2e test — every issue looked
// "edited after checks" the instant it was approved, because approving IS an update. GraphQL's
// Issue.lastEditedAt tracks only body edits (stays null for label-only changes; title renames are tracked
// separately and still come from the REST timeline's 'renamed' event, handled in editedAfterChecks).
async function fetchLastEditedAt(n) {
  const [owner, repo] = GITHUB_REPOSITORY.split('/');
  const query = 'query($owner:String!,$repo:String!,$n:Int!){ repository(owner:$owner,name:$repo){ issue(number:$n){ lastEditedAt } } }';
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GH_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { owner, repo, n } }),
  });
  const json = await res.json();
  return json?.data?.repository?.issue?.lastEditedAt ?? null;
}

async function reportFailure(issueNumber, reasons) {
  const body = `❌ This can't be added yet:\n\n${reasons.map((x) => `- ${x}`).join('\n')}\n\nEdit the issue to fix it and the checks run again.`;
  await api(`/issues/${issueNumber}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
  await api(`/issues/${issueNumber}/labels`, { method: 'PUT', body: JSON.stringify({ labels: ['submission', 'needs-fix'] }) });
}

// Prepare: list issues carrying BOTH 'approved' and 'checks-passed', re-validate each (timeline + a fresh
// fetch of the posting), write the data files if anything was added, and report failures immediately
// (failures don't touch the data files, so they're safe to report before the commit/push happens).
async function prepare() {
  const issues = await listCandidateIssues();
  const submitted = JSON.parse(readFileSync('data/submitted.json', 'utf8'));
  const internships = JSON.parse(readFileSync('data/internships.json', 'utf8'));
  const existingBase = [...internships, ...submitted];
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

  const candidates = [];
  const failures = [];

  for (const issue of issues) {
    const n = issue.number;
    if (hasIssueNumber(submitted, n)) continue; // already applied by an earlier sweep run

    const timeline = await fetchTimeline(n);
    const lastEditedAt = await fetchLastEditedAt(n);
    if (timeline === null || editedAfterChecks(timeline, lastEditedAt)) {
      failures.push({ issueNumber: n, reasons: ['The issue was edited after the checks; the checks will re-run.'] });
      continue;
    }

    const fields = parseIssueForm(issue.body ?? '');
    const page = await fetchPosting(fields.url);
    const existing = [...existingBase, ...candidates.map((c) => c.row)];
    const r = validateSubmission({ fields, openByAuthor: 0, existing, page });
    if (!r.ok) { failures.push({ issueNumber: n, reasons: r.reasons }); continue; }

    candidates.push({ issueNumber: n, row: submissionRow(fields, r.section, n, issue.user.login, today) });
  }

  const merged = mergeApprovedRows(submitted, candidates);

  if (merged.added.length) {
    writeFileSync('data/submitted.json', JSON.stringify(merged.rows, null, 2) + '\n');
    const prevMeta = JSON.parse(readFileSync('data/meta.json', 'utf8'));
    const prevClosed = JSON.parse(readFileSync('data/closed.json', 'utf8'));
    const prevDesk = JSON.parse(readFileSync('data/desk.json', 'utf8'));
    writeFileSync('README.md', renderReadme({ rows: [...internships.filter((r) => r.source !== 'submitted'), ...merged.rows], closed: prevClosed, desk: prevDesk, meta: prevMeta }));
  }

  for (const f of failures) await reportFailure(f.issueNumber, f.reasons);

  const manifest = { added: candidates.filter((c) => merged.added.includes(c.issueNumber)).map((c) => ({ issueNumber: c.issueNumber, url: c.row.url, author: c.row.submitted_by })) };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`sweep prepare: ${merged.added.length} added, ${merged.skipped.length} already present, ${failures.length} failed`);
}

// Finalize: run only after the commit+push of data/submitted.json + README.md has succeeded. Closes and
// thanks each issue that was actually added, echoing the exact URL that was committed.
async function finalize() {
  let manifest = { added: [] };
  try { manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')); } catch { /* nothing prepared, e.g. zero additions */ }
  for (const a of manifest.added ?? []) {
    await api(`/issues/${a.issueNumber}/comments`, { method: 'POST', body: JSON.stringify({ body: `Added to the list: ${a.url}. Thank you @${a.author}!` }) });
    await api(`/issues/${a.issueNumber}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) });
  }
  console.log(`sweep finalize: closed ${manifest.added?.length ?? 0} issue(s)`);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const mode = process.argv[2];
  if (mode === 'finalize') await finalize();
  else await prepare();
}

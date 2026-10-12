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

// Fix round 2, finding 5: daily.yml runs this sweep on a schedule with NO actor check (unlike approve.yml's
// `if:` gate, which only fires on an event sent by the owner). That means on daily.yml's path the 'approved'
// label could have been applied by anyone with label permissions, not just the maintainer. This re-derives
// "who actually approved it" from the same timeline already fetched for the edit check, using the most
// recent 'labeled' event for 'approved' — mirroring editedAfterChecks' "latest wins" handling of re-labelling.
export const OWNER_LOGIN = 'Arun-Raghav-S';

export function verifyApprovedByOwner(events = [], ownerLogin = OWNER_LOGIN) {
  const approvedEvents = events.filter((e) => e.event === 'labeled' && e.label?.name === 'approved');
  if (!approvedEvents.length) return false; // no record of the label ever being applied -> fail closed
  const latest = approvedEvents.reduce((a, b) => (Date.parse(a.created_at) >= Date.parse(b.created_at) ? a : b));
  return latest.actor?.login === ownerLogin;
}

// Fix round 2, finding 7: the manifest finalize() walks to close+thank issues. Must include BOTH issues
// newly added this run (candidates whose issueNumber made it into mergeApprovedRows' `added`) AND issues that
// already carry a row in submitted.json from an EARLIER sweep run but are still open+approved — prepare()'s
// main loop skips those before ever building a candidate for them (hasIssueNumber early-continue), so without
// this they would sit open forever even though their data already shipped. Never lists the same issue twice,
// and never fabricates a row — an open issue with neither a candidate nor an existing submitted row is simply
// not finalize's job yet (it's still pending or it failed validation).
export function buildFinalizeManifest({ openIssueNumbers, submitted, candidates, added }) {
  const manifest = [];
  const seen = new Set();
  for (const c of candidates) {
    if (!added.includes(c.issueNumber) || seen.has(c.issueNumber)) continue;
    manifest.push({ issueNumber: c.issueNumber, url: c.row.url, author: c.row.submitted_by });
    seen.add(c.issueNumber);
  }
  for (const n of openIssueNumbers) {
    if (seen.has(n)) continue;
    const row = submitted.find((r) => hasIssueNumber([r], n));
    if (!row) continue;
    manifest.push({ issueNumber: n, url: row.url, author: row.submitted_by });
    seen.add(n);
  }
  return manifest;
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
// Fix round 2, finding 2: this used to swallow every failure mode (GraphQL {errors}, a non-OK HTTP status, a
// response with no `issue`) into `?? null`, which is indistinguishable from "a real, successful answer of
// null" (an issue that was genuinely never edited). editedAfterChecks treats null as "clean", so any of those
// failures made a since-edited issue look safe to auto-approve — fail OPEN on a transient API hiccup, which is
// the opposite of what a security check should do. Now every failure mode throws; callers must catch and treat
// that as "edited" (refuse), never as "not edited". `fetchImpl` is injectable so tests never hit the network.
export async function fetchLastEditedAt(n, { fetchImpl = fetch } = {}) {
  const [owner, repo] = (GITHUB_REPOSITORY ?? 'owner/repo').split('/');
  const query = 'query($owner:String!,$repo:String!,$n:Int!){ repository(owner:$owner,name:$repo){ issue(number:$n){ lastEditedAt } } }';
  let res;
  try {
    res = await fetchImpl('https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${GH_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { owner, repo, n } }),
    });
  } catch (e) {
    throw new Error(`fetchLastEditedAt(${n}): network error: ${e.message ?? e}`);
  }
  if (!res.ok) throw new Error(`fetchLastEditedAt(${n}): HTTP ${res.status}`);
  const json = await res.json();
  if (json?.errors) throw new Error(`fetchLastEditedAt(${n}): GraphQL errors: ${JSON.stringify(json.errors)}`);
  const issue = json?.data?.repository?.issue;
  if (!issue) throw new Error(`fetchLastEditedAt(${n}): response had no issue`);
  return issue.lastEditedAt ?? null;
}

async function checkOk(res, label) {
  if (!res.ok) console.error(`GitHub API call failed (${label}): HTTP ${res.status}`);
  return res.ok;
}

async function reportFailure(issueNumber, reasons) {
  const body = `❌ This can't be added yet:\n\n${reasons.map((x) => `- ${x}`).join('\n')}\n\nEdit the issue to fix it and the checks run again.`;
  await checkOk(await api(`/issues/${issueNumber}/comments`, { method: 'POST', body: JSON.stringify({ body }) }), `comment on #${issueNumber}`);
  await checkOk(await api(`/issues/${issueNumber}/labels`, { method: 'PUT', body: JSON.stringify({ labels: ['submission', 'needs-fix'] }) }), `relabel #${issueNumber}`);
}

// Fix round 2, finding 5: the 'approved' label was applied by someone other than the maintainer. Strip
// 'approved' (keep 'submission' + 'checks-passed' so it can be re-approved correctly) and say why.
async function reportNotOwnerApproved(issueNumber) {
  const body = 'Approval label must be applied by a maintainer';
  await checkOk(await api(`/issues/${issueNumber}/comments`, { method: 'POST', body: JSON.stringify({ body }) }), `comment on #${issueNumber}`);
  await checkOk(await api(`/issues/${issueNumber}/labels`, { method: 'PUT', body: JSON.stringify({ labels: ['submission', 'checks-passed'] }) }), `relabel #${issueNumber}`);
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
    if (timeline === null) {
      failures.push({ issueNumber: n, reasons: ['The issue was edited after the checks; the checks will re-run.'] });
      continue;
    }

    // Fix round 2, finding 5: daily.yml's schedule invokes this sweep with no actor check at all, so the
    // 'approved' label itself must be attributed here, from the same timeline, before anything else runs.
    if (!verifyApprovedByOwner(timeline)) {
      await reportNotOwnerApproved(n);
      continue;
    }

    // Fix round 2, finding 2: fetchLastEditedAt now throws on any API failure instead of silently returning
    // null (which editedAfterChecks reads as "clean"). A thrown error here must fail CLOSED — treated exactly
    // like "edited after checks" — never treated as "not edited".
    let lastEditedAt;
    try {
      lastEditedAt = await fetchLastEditedAt(n);
    } catch (e) {
      console.error(`fetchLastEditedAt failed for #${n}, treating as edited: ${e.message}`);
      failures.push({ issueNumber: n, reasons: ['The issue was edited after the checks; the checks will re-run.'] });
      continue;
    }
    if (editedAfterChecks(timeline, lastEditedAt)) {
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

  // Fix round 2, finding 7: an issue already carrying a row in submitted.json from an EARLIER sweep run (the
  // `hasIssueNumber(submitted, n)` early-continue above) never becomes a candidate this run, so it used to be
  // silently dropped from this manifest and stayed open forever even though its data had already shipped.
  // buildFinalizeManifest adds those back in by issue number, without duplicating the row.
  const manifest = { added: buildFinalizeManifest({ openIssueNumbers: issues.map((i) => i.number), submitted: merged.rows, candidates, added: merged.added }) };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`sweep prepare: ${merged.added.length} added, ${merged.skipped.length} already present, ${failures.length} failed`);
}

// Finalize: run only after the commit+push of data/submitted.json + README.md has succeeded. Closes and
// thanks each issue that was actually added, echoing the exact URL that was committed.
async function finalize() {
  let manifest = { added: [] };
  try { manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')); } catch { /* nothing prepared, e.g. zero additions */ }
  for (const a of manifest.added ?? []) {
    // Fix round 2, finding 7: check res.ok on each call and log failures instead of assuming every GitHub API
    // call succeeded — a silent 403/404/5xx here used to leave an issue un-labelled, un-thanked, or still open
    // with no record anything went wrong.
    // drop any stale 'needs-fix' from an earlier failed attempt on the same issue; mark it verified+added.
    await checkOk(await api(`/issues/${a.issueNumber}/labels`, { method: 'PUT', body: JSON.stringify({ labels: ['submission', 'checks-passed', 'approved', 'verified'] }) }), `relabel #${a.issueNumber}`);
    await checkOk(await api(`/issues/${a.issueNumber}/comments`, { method: 'POST', body: JSON.stringify({ body: `Added to the list: ${a.url}. Thank you @${a.author}!` }) }), `comment on #${a.issueNumber}`);
    await checkOk(await api(`/issues/${a.issueNumber}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'completed' }) }), `close #${a.issueNumber}`);
  }
  console.log(`sweep finalize: closed ${manifest.added?.length ?? 0} issue(s)`);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const mode = process.argv[2];
  if (mode === 'finalize') await finalize();
  else await prepare();
}

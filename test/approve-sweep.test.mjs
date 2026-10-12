import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editedAfterChecks, hasIssueNumber, mergeApprovedRows, fetchLastEditedAt, verifyApprovedByOwner, OWNER_LOGIN, buildFinalizeManifest } from '../scripts/approve-sweep.mjs';

// --- editedAfterChecks ---

test('editedAfterChecks: false when nothing happened after the checks-passed labelling', () => {
  const events = [{ event: 'labeled', label: { name: 'submission' }, created_at: '2026-10-12T10:00:00Z' }, { event: 'labeled', label: { name: 'checks-passed' }, created_at: '2026-10-12T10:05:00Z' }];
  assert.equal(editedAfterChecks(events, '2026-10-12T10:05:00Z'), false);
});

test('editedAfterChecks: true when an edited event is newer than the latest checks-passed labelling', () => {
  const events = [{ event: 'labeled', label: { name: 'checks-passed' }, created_at: '2026-10-12T10:05:00Z' }, { event: 'edited', created_at: '2026-10-12T10:10:00Z' }];
  assert.equal(editedAfterChecks(events, '2026-10-12T10:10:00Z'), true);
});

test('editedAfterChecks: true when a renamed event is newer than the latest checks-passed labelling', () => {
  const events = [{ event: 'labeled', label: { name: 'checks-passed' }, created_at: '2026-10-12T10:05:00Z' }, { event: 'renamed', created_at: '2026-10-12T10:06:00Z' }];
  assert.equal(editedAfterChecks(events, null), true);
});

test('editedAfterChecks: true when the issue body was last edited after the latest checks-passed labelling (GraphQL lastEditedAt), even with no matching timeline event', () => {
  const events = [{ event: 'labeled', label: { name: 'checks-passed' }, created_at: '2026-10-12T10:05:00Z' }];
  assert.equal(editedAfterChecks(events, '2026-10-12T10:09:00Z'), true);
});

// Regression: a REST issue.updated_at bump from label churn alone (adding 'approved', the sweep's own later
// unlabel/relabel) must NEVER be mistaken for a body edit. The second argument must be the issue's body-edit
// timestamp (GraphQL Issue.lastEditedAt, which stays null when only labels changed), not issue.updated_at —
// updated_at is bumped by every labeled/unlabeled event and would make every approval look "edited after
// checks" even when nothing was ever edited. This exact bug blocked a real approval in fix round 1's own e2e.
test('editedAfterChecks: false when only labels changed after checks-passed (lastEditedAt is null) — no false positive from label churn', () => {
  const events = [
    { event: 'labeled', label: { name: 'submission' }, created_at: '2026-10-12T10:00:00Z' },
    { event: 'labeled', label: { name: 'checks-passed' }, created_at: '2026-10-12T10:05:00Z' },
    { event: 'labeled', label: { name: 'approved' }, created_at: '2026-10-12T10:20:00Z' },
  ];
  assert.equal(editedAfterChecks(events, null), false);
});

test('editedAfterChecks: uses the LATEST checks-passed labelling when checks re-ran more than once', () => {
  const events = [
    { event: 'labeled', label: { name: 'checks-passed' }, created_at: '2026-10-12T09:00:00Z' },
    { event: 'edited', created_at: '2026-10-12T09:30:00Z' },
    { event: 'labeled', label: { name: 'needs-fix' }, created_at: '2026-10-12T09:31:00Z' },
    { event: 'labeled', label: { name: 'checks-passed' }, created_at: '2026-10-12T09:45:00Z' },
  ];
  // the 09:30 edit happened before the SECOND (latest) checks-passed labelling at 09:45, so this is clean
  assert.equal(editedAfterChecks(events, '2026-10-12T09:45:00Z'), false);
});

test('editedAfterChecks: true when there is no checks-passed labelling at all (defensive default)', () => {
  assert.equal(editedAfterChecks([{ event: 'labeled', label: { name: 'submission' }, created_at: '2026-10-12T10:00:00Z' }], null), true);
});

// --- fetchLastEditedAt (fix round 2, finding 2: must never fail open) ---

const jsonResponse = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('fetchLastEditedAt: a GraphQL {errors} response throws rather than returning null', async () => {
  const fetchImpl = jsonResponse(200, { errors: [{ message: 'Could not resolve to an Issue' }] });
  await assert.rejects(() => fetchLastEditedAt(1, { fetchImpl }));
});

test('fetchLastEditedAt: a non-OK HTTP status throws rather than returning null', async () => {
  const fetchImpl = jsonResponse(502, {});
  await assert.rejects(() => fetchLastEditedAt(1, { fetchImpl }));
});

test('fetchLastEditedAt: a response missing data.repository.issue throws rather than returning null', async () => {
  const fetchImpl = jsonResponse(200, { data: { repository: { issue: null } } });
  await assert.rejects(() => fetchLastEditedAt(1, { fetchImpl }));
});

test('fetchLastEditedAt: a valid response with lastEditedAt: null (never edited) resolves to null, not a throw', async () => {
  const fetchImpl = jsonResponse(200, { data: { repository: { issue: { lastEditedAt: null } } } });
  const r = await fetchLastEditedAt(1, { fetchImpl });
  assert.equal(r, null);
});

test('fetchLastEditedAt: a valid response with a real timestamp is passed through', async () => {
  const fetchImpl = jsonResponse(200, { data: { repository: { issue: { lastEditedAt: '2026-10-12T10:10:00Z' } } } });
  const r = await fetchLastEditedAt(1, { fetchImpl });
  assert.equal(r, '2026-10-12T10:10:00Z');
});

// --- verifyApprovedByOwner (fix round 2, finding 5) ---

test('OWNER_LOGIN is the single constant naming the maintainer', () => {
  assert.equal(OWNER_LOGIN, 'Arun-Raghav-S');
});

test('verifyApprovedByOwner: true when the most recent "approved" labelling was done by the owner', () => {
  const events = [
    { event: 'labeled', label: { name: 'checks-passed' }, created_at: '2026-10-12T10:00:00Z', actor: { login: 'github-actions[bot]' } },
    { event: 'labeled', label: { name: 'approved' }, created_at: '2026-10-12T10:05:00Z', actor: { login: 'Arun-Raghav-S' } },
  ];
  assert.equal(verifyApprovedByOwner(events), true);
});

test('verifyApprovedByOwner: false when the most recent "approved" labelling was done by someone else', () => {
  const events = [{ event: 'labeled', label: { name: 'approved' }, created_at: '2026-10-12T10:05:00Z', actor: { login: 'some-random-collaborator' } }];
  assert.equal(verifyApprovedByOwner(events), false);
});

test('verifyApprovedByOwner: uses the LATEST "approved" labelling, not an earlier one, when it was unlabeled and relabeled', () => {
  const events = [
    { event: 'labeled', label: { name: 'approved' }, created_at: '2026-10-12T09:00:00Z', actor: { login: 'Arun-Raghav-S' } },
    { event: 'unlabeled', label: { name: 'approved' }, created_at: '2026-10-12T09:30:00Z', actor: { login: 'Arun-Raghav-S' } },
    { event: 'labeled', label: { name: 'approved' }, created_at: '2026-10-12T10:00:00Z', actor: { login: 'some-random-collaborator' } },
  ];
  assert.equal(verifyApprovedByOwner(events), false);
});

test('verifyApprovedByOwner: false (fail closed) when there is no "approved" labelling event at all', () => {
  assert.equal(verifyApprovedByOwner([{ event: 'labeled', label: { name: 'checks-passed' }, created_at: '2026-10-12T10:00:00Z', actor: { login: 'Arun-Raghav-S' } }]), false);
});

// --- buildFinalizeManifest (fix round 2, finding 7) ---

const submittedRow = (n, over = {}) => ({ id: `acme:submitted:${n}`, company: 'Acme', company_slug: 'acme', role: 'SDE Intern', location: 'Pune', section: 'india', url: `https://x/${n}`, posted: '2026-10-12', batch: 'Any', stipend: null, source: 'submitted', first_seen: '2026-10-12', submitted_by: `student${n}`, ...over });

test('buildFinalizeManifest: includes an issue newly added this run', () => {
  const candidates = [{ issueNumber: 7, row: submittedRow(7) }];
  const manifest = buildFinalizeManifest({ openIssueNumbers: [7], submitted: [submittedRow(7)], candidates, added: [7] });
  assert.deepEqual(manifest, [{ issueNumber: 7, url: 'https://x/7', author: 'student7' }]);
});

test('buildFinalizeManifest: includes an issue whose row is already in submitted.json (from an earlier run) but is still open and approved — no duplicate row, but it still gets closed', () => {
  // issue 3 is open+approved (so listCandidateIssues returned it) but its row already exists from a prior sweep,
  // so prepare()'s loop skips it before ever building a candidate for it this run.
  const manifest = buildFinalizeManifest({ openIssueNumbers: [3], submitted: [submittedRow(3)], candidates: [], added: [] });
  assert.deepEqual(manifest, [{ issueNumber: 3, url: 'https://x/3', author: 'student3' }]);
});

test('buildFinalizeManifest: an open issue with neither a candidate nor an existing row is excluded (not actually applied yet)', () => {
  const manifest = buildFinalizeManifest({ openIssueNumbers: [9], submitted: [], candidates: [], added: [] });
  assert.deepEqual(manifest, []);
});

test('buildFinalizeManifest: never lists the same issue number twice', () => {
  const candidates = [{ issueNumber: 7, row: submittedRow(7) }];
  const manifest = buildFinalizeManifest({ openIssueNumbers: [7], submitted: [submittedRow(7)], candidates, added: [7] });
  assert.equal(manifest.length, 1);
});

// --- hasIssueNumber / mergeApprovedRows (idempotence) ---

const row = (n) => ({ id: `acme:submitted:${n}`, company: 'Acme', company_slug: 'acme', role: 'SDE Intern', location: 'Pune', section: 'india', url: `https://x/${n}`, posted: '2026-10-12', batch: 'Any', stipend: null, source: 'submitted', first_seen: '2026-10-12', submitted_by: 'student' });

test('hasIssueNumber finds an existing row by its issue number suffix', () => {
  assert.equal(hasIssueNumber([row(1), row(2)], 2), true);
  assert.equal(hasIssueNumber([row(1)], 2), false);
});

test('mergeApprovedRows is idempotent: a sweep that re-processes an already-applied issue number skips it', () => {
  const existing = [row(1)];
  const candidates = [{ issueNumber: 1, row: row(1) }, { issueNumber: 2, row: row(2) }];
  const merged = mergeApprovedRows(existing, candidates);
  assert.deepEqual(merged.added, [2]);
  assert.deepEqual(merged.skipped, [1]);
  assert.equal(merged.rows.length, 2);
});

test('mergeApprovedRows: running the sweep twice on the same candidates produces the same final rows (no duplicates)', () => {
  const existing = [];
  const candidates = [{ issueNumber: 1, row: row(1) }, { issueNumber: 2, row: row(2) }];
  const firstPass = mergeApprovedRows(existing, candidates);
  const secondPass = mergeApprovedRows(firstPass.rows, candidates);
  assert.equal(secondPass.added.length, 0);
  assert.deepEqual(secondPass.skipped, [1, 2]);
  assert.equal(secondPass.rows.length, 2);
});

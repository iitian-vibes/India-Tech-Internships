import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editedAfterChecks, hasIssueNumber, mergeApprovedRows } from '../scripts/approve-sweep.mjs';

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

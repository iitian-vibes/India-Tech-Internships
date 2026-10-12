import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIssueForm, validateSubmission, submissionRow } from '../scripts/submission.mjs';

const body = `### Company\n\nZepto\n\n### Role title (exactly as on the posting)\n\nSDE Intern\n\n### Link to the posting\n\nhttps://jobs.lever.co/zepto/abc\n\n### Location\n\nMumbai\n\n### Stipend (only if the posting says)\n\n_No response_\n\n### Graduation year it is for (optional)\n\n2027\n\n### Company careers site\n\nhttps://www.zeptonow.com/careers`;
const fields = parseIssueForm(body);
const okPage = { status: 200, text: 'Zepto is hiring an SDE Intern in Mumbai. Students graduating in 2027.' };

test('parseIssueForm reads every field and treats _No response_ as empty', () => {
  assert.deepEqual(fields, { company: 'Zepto', role: 'SDE Intern', url: 'https://jobs.lever.co/zepto/abc', location: 'Mumbai', stipend: '', batch: '2027', careers_site: 'https://www.zeptonow.com/careers' });
});

test('a good submission passes', () => {
  const r = validateSubmission({ fields, openByAuthor: 1, existing: [], page: okPage });
  assert.deepEqual(r, { ok: true, reasons: [], section: 'india' });
});

test('each bad case is rejected with a readable reason', () => {
  const cases = [
    [{ page: { status: 404, text: '' } }, /link does not open a live posting/],
    [{ fields: { ...fields, role: 'Senior SDE' } }, /not an internship or new-grad role/],
    [{ fields: { ...fields, role: 'Marketing Intern' } }, /not a tech role/],
    [{ page: { status: 200, text: 'SDE Intern. Must be authorized to work in the United States.' } }, /requires existing work authorisation/],
    [{ existing: [{ url: 'https://jobs.lever.co/zepto/abc' }] }, /already on the list/],
    [{ fields: { ...fields, url: 'https://unstop.com/x' } }, /company's own site or job board/],
    [{ fields: { ...fields, location: 'Austin, TX' }, page: { status: 200, text: 'SDE Intern in Austin' } }, /not open to students in India/],
    [{ openByAuthor: 6 }, /more than 5 open submissions/],
    [{ fields: { ...fields, url: 'http://jobs.lever.co/zepto/abc' } }, /https/],
  ];
  for (const [over, re] of cases) {
    const r = validateSubmission({ fields, openByAuthor: 1, existing: [], page: okPage, ...over });
    assert.equal(r.ok, false, String(re));
    assert.ok(r.reasons.some((x) => re.test(x)), `${re} not in ${JSON.stringify(r.reasons)}`);
  }
});

test('submissionRow credits the author and uses a stable id', () => {
  const r = submissionRow(fields, 'india', 42, 'student1', '2026-10-12');
  assert.equal(r.id, 'zepto:submitted:42');
  assert.equal(r.submitted_by, 'student1');
  assert.equal(r.source, 'submitted');
  assert.equal(r.stipend, null);
});

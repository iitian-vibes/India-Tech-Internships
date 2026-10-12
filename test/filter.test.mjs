import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStudentRole, classifyLocation, hasWorkAuthBlock, batchOf, stipendOf, toRow } from '../scripts/filter.mjs';

const job = (o) => ({ jobId: '1', title: 'SDE Intern', locations: ['Bengaluru'], remote: false, url: 'https://x/1', posted: '2026-10-10T00:00:00.000Z', text: '', employmentType: '', stipendHint: null, ...o });
const co = { name: 'Acme', slug: 'acme', ats: 'lever', abroad_visa: false };

test('student roles', () => {
  for (const t of ['Software Engineering Intern', 'SDE Internship (6 months)', 'Graduate Engineer Trainee', 'New Grad SWE 2027', 'Data Science Apprentice']) assert.equal(isStudentRole(t, ''), true, t);
  for (const t of ['Senior Software Engineer', 'Intern Program Manager', 'Staff ML Engineer', 'PhD Research Intern', 'Engineering Lead, Interns', 'Accounts Payable Manager']) assert.equal(isStudentRole(t, ''), false, t);
  assert.equal(isStudentRole('Software Engineer', 'Internship'), true);
  assert.equal(isStudentRole('Software Engineer', 'Intern'), true);
});

test('location classification table', () => {
  const cases = [
    [['Bengaluru'], false, 'india'], [['Bangalore, KA'], false, 'india'], [['Bengaluru, Karnataka, India'], false, 'india'],
    [['Hybrid - Gurugram'], false, 'india'], [['India, Bengaluru'], false, 'india'], [['Mumbai', 'London'], false, 'india'],
    [['Remote - India'], true, 'remote'], [['Remote (APAC)'], true, 'remote'], [['Remote'], true, null],
    [['San Francisco'], false, null], [['Indianapolis, IN'], false, null], [[], false, null],
  ];
  for (const [locations, remote, want] of cases) assert.equal(classifyLocation(job({ locations, remote }), co), want, JSON.stringify(locations));
  assert.equal(classifyLocation(job({ locations: ['London'] }), { ...co, abroad_visa: true }), 'abroad');
});

test('work authorisation blocks', () => {
  for (const t of ['Candidates must be authorized to work in the United States.', 'US citizens only.', 'We are unable to provide visa sponsorship for this role.', 'You must have the right to work in the UK.', 'Requires an active security clearance.']) assert.equal(hasWorkAuthBlock(t), true, t);
  for (const t of ['We sponsor visas for interns.', 'Open to students across India.', '']) assert.equal(hasWorkAuthBlock(t), false, t);
});

test('batch only from explicit graduation context', () => {
  assert.equal(batchOf('SDE Intern', 'Open to students graduating in 2027.'), '2027');
  assert.equal(batchOf('SDE Intern', 'Class of 2028 preferred.'), '2028');
  assert.equal(batchOf('Summer Intern 2027', 'Work on payments.'), 'Any');
});

test('stipend only when stated next to the word stipend, or from the board hint', () => {
  assert.equal(stipendOf('Stipend: ₹50,000 per month.', null), '₹50,000 per month');
  assert.equal(stipendOf('We pay a stipend of INR 40,000/month.', null), 'INR 40,000/month');
  assert.equal(stipendOf('Revenue of ₹500 crore last year.', null), null);
  assert.equal(stipendOf('', '₹1L per month'), '₹1L per month');
});

test('toRow builds a Row or returns null', () => {
  const r = toRow(job({ text: 'Stipend: ₹50,000 per month. Graduating in 2027.' }), co, '2026-10-12');
  assert.deepEqual(r, { id: 'acme:lever:1', company: 'Acme', company_slug: 'acme', role: 'SDE Intern', location: 'Bengaluru', section: 'india', url: 'https://x/1', posted: '2026-10-10', batch: '2027', stipend: '₹50,000 per month', source: 'lever', first_seen: '2026-10-12' });
  assert.equal(toRow(job({ title: 'Senior Engineer' }), co, '2026-10-12'), null);
  assert.equal(toRow(job({ locations: ['Austin'] }), co, '2026-10-12'), null);
  assert.equal(toRow(job({ text: 'US citizens only.' }), co, '2026-10-12'), null);
  assert.equal(toRow(job({ url: '' }), co, '2026-10-12'), null);
});

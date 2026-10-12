import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGreenhouse } from '../scripts/fetch/greenhouse.mjs';
import { parseLever } from '../scripts/fetch/lever.mjs';
import { parseAshby } from '../scripts/fetch/ashby.mjs';
import { htmlToText } from '../scripts/fetch/util.mjs';

const co = { name: 'X', slug: 'x', board: 'x' };

test('greenhouse: maps fields, trims title, decodes escaped HTML content', () => {
  const jobs = parseGreenhouse({ jobs: [{ id: 47, title: ' SDE Intern ', absolute_url: 'https://job-boards.greenhouse.io/x/jobs/47', location: { name: 'Bengaluru' }, first_published: '2026-10-09T06:43:46-04:00', updated_at: '2026-10-10T00:00:00-04:00', content: '&lt;p&gt;Stipend: &amp;#8377;50,000 per month&lt;/p&gt;' }] }, co);
  assert.deepEqual(jobs[0], { jobId: '47', title: 'SDE Intern', locations: ['Bengaluru'], remote: false, url: 'https://job-boards.greenhouse.io/x/jobs/47', posted: '2026-10-09T10:43:46.000Z', text: 'Stipend: ₹50,000 per month', employmentType: '', stipendHint: null });
});

test('greenhouse: remote flagged from location text; missing jobs array is empty', () => {
  assert.equal(parseGreenhouse({ jobs: [{ id: 1, title: 'Intern', absolute_url: 'u', location: { name: 'Remote - India' }, content: '' }] }, co)[0].remote, true);
  assert.deepEqual(parseGreenhouse({}, co), []);
});

test('lever: uses allLocations, commitment, createdAt millis, workplaceType', () => {
  const jobs = parseLever([{ id: 'ab', text: 'Data Intern', hostedUrl: 'https://jobs.lever.co/x/ab', categories: { commitment: 'Internship', location: 'Pune', allLocations: ['Pune', 'Mumbai'] }, createdAt: 1790573982021, workplaceType: 'onsite', descriptionPlain: 'Work on data.', additionalPlain: 'Graduating 2027.' }], co);
  assert.deepEqual(jobs[0], { jobId: 'ab', title: 'Data Intern', locations: ['Pune', 'Mumbai'], remote: false, url: 'https://jobs.lever.co/x/ab', posted: new Date(1790573982021).toISOString(), text: 'Work on data.\nGraduating 2027.', employmentType: 'Internship', stipendHint: null });
});

test('lever: error object (404 body) yields no jobs', () => {
  assert.deepEqual(parseLever({ ok: false, error: 'Document not found' }, co), []);
});

test('ashby: skips unlisted, merges secondary locations, reads compensation summary', () => {
  const jobs = parseAshby({ jobs: [
    { id: 'j1', title: 'ML Intern', isListed: true, location: 'Bengaluru', secondaryLocations: [{ location: 'Remote' }], isRemote: false, workplaceType: 'Hybrid', jobUrl: 'https://jobs.ashbyhq.com/x/j1', publishedAt: '2026-10-01T00:00:00.000+00:00', descriptionPlain: 'Build models.', employmentType: 'Intern', compensation: { compensationTierSummary: '₹1L per month' } },
    { id: 'j2', title: 'Hidden', isListed: false, location: 'Delhi', jobUrl: 'u' }
  ] }, co);
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0], { jobId: 'j1', title: 'ML Intern', locations: ['Bengaluru', 'Remote'], remote: false, url: 'https://jobs.ashbyhq.com/x/j1', posted: '2026-10-01T00:00:00.000Z', text: 'Build models.', employmentType: 'Intern', stipendHint: '₹1L per month' });
});

test('htmlToText: strips tags, decodes named and numeric entities, collapses blank lines', () => {
  assert.equal(htmlToText('<div><p>A &amp; B</p><p>&#8377;5 &nbsp;x</p></div>'), 'A & B\n₹5 x');
});

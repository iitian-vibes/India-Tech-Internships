import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePostedOn, parseWorkdayList } from '../scripts/fetch/workday.mjs';

const now = new Date('2026-10-12T06:00:00Z');
test('parsePostedOn handles Today, Yesterday, N Days Ago and 30+', () => {
  assert.equal(parsePostedOn('Posted Today', now), '2026-10-12T00:00:00.000Z');
  assert.equal(parsePostedOn('Posted Yesterday', now), '2026-10-11T00:00:00.000Z');
  assert.equal(parsePostedOn('Posted 26 Days Ago', now), '2026-09-16T00:00:00.000Z');
  assert.equal(parsePostedOn('Posted 30+ Days Ago', now), null);
  assert.equal(parsePostedOn(undefined, now), null);
});

test('parseWorkdayList builds the public URL from host, site and externalPath', () => {
  const co = { slug: 'nvidia', workday: { host: 'nvidia.wd5.myworkdayjobs.com', tenant: 'nvidia', site: 'NVIDIAExternalCareerSite' } };
  const jobs = parseWorkdayList({ jobPostings: [{ title: 'ASIC Intern - 2027', externalPath: '/job/India-Bengaluru/ASIC-Intern---2027_JR1', locationsText: 'India, Bengaluru', postedOn: 'Posted Today', bulletFields: ['JR1'] }] }, co, now);
  assert.deepEqual(jobs[0], { jobId: 'JR1', title: 'ASIC Intern - 2027', locations: ['India, Bengaluru'], remote: false, url: 'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/India-Bengaluru/ASIC-Intern---2027_JR1', posted: '2026-10-12T00:00:00.000Z', text: '', employmentType: '', stipendHint: null });
});

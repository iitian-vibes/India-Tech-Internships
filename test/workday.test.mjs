import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { parsePostedOn, parseWorkdayList, fetchWorkday } from '../scripts/fetch/workday.mjs';

const now = new Date('2026-10-12T06:00:00Z');
test('parsePostedOn handles Today, Yesterday, N Days Ago and 30+ (UTC midnight)', () => {
  assert.equal(parsePostedOn('Posted Today', now), '2026-10-11T18:30:00.000Z');
  assert.equal(parsePostedOn('Posted Yesterday', now), '2026-10-10T18:30:00.000Z');
  assert.equal(parsePostedOn('Posted 26 Days Ago', now), '2026-09-15T18:30:00.000Z');
  assert.equal(parsePostedOn('Posted 30+ Days Ago', now), null);
  assert.equal(parsePostedOn(undefined, now), null);
});

test('parsePostedOn at IST boundary (2026-10-12T20:00:00Z = IST 2026-10-13)', () => {
  const istBoundary = new Date('2026-10-12T20:00:00Z');
  assert.equal(parsePostedOn('Posted Today', istBoundary), '2026-10-12T18:30:00.000Z');
});

test('parseWorkdayList builds the public URL from host, site and externalPath', () => {
  const co = { slug: 'nvidia', workday: { host: 'nvidia.wd5.myworkdayjobs.com', tenant: 'nvidia', site: 'NVIDIAExternalCareerSite' } };
  const jobs = parseWorkdayList({ jobPostings: [{ title: 'ASIC Intern - 2027', externalPath: '/job/India-Bengaluru/ASIC-Intern---2027_JR1', locationsText: 'India, Bengaluru', postedOn: 'Posted Today', bulletFields: ['JR1'] }] }, co, now);
  assert.deepEqual(jobs[0], { jobId: 'JR1', title: 'ASIC Intern - 2027', locations: ['India, Bengaluru'], remote: false, url: 'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/India-Bengaluru/ASIC-Intern---2027_JR1', posted: '2026-10-11T18:30:00.000Z', text: '', employmentType: '', stipendHint: null });
});

test('fetchWorkday paginates through pages with no total field', async () => {
  const co = { slug: 'test', workday: { host: 'test.example.com', tenant: 'test', site: 'TestSite' } };
  const mockFetcher = mock.fn(async (url, opts) => {
    const body = opts?.body || {};
    if (body.offset === 0) return { jobPostings: Array(20).fill({ title: 'Job', externalPath: '/job/test_JR1', locationsText: 'Test', postedOn: 'Posted Today', bulletFields: ['JR1'] }) };
    if (body.offset === 20) return { jobPostings: Array(20).fill({ title: 'Job', externalPath: '/job/test_JR2', locationsText: 'Test', postedOn: 'Posted Today', bulletFields: ['JR2'] }) };
    if (body.offset === 40) return { jobPostings: Array(5).fill({ title: 'Job', externalPath: '/job/test_JR3', locationsText: 'Test', postedOn: 'Posted Today', bulletFields: ['JR3'] }) };
    return { jobPostings: [] };
  });
  const jobs = await fetchWorkday(co, { wantDetail: () => false, now, fetchJsonImpl: mockFetcher });
  assert.equal(jobs.length, 45);
});

test('fetchWorkday extracts detail path correctly when site name appears in externalPath', async () => {
  const co = { slug: 'test', workday: { host: 'test.example.com', tenant: 'test', site: 'Careers' } };
  const detailUrls = [];
  const mockFetcher = mock.fn(async (url, opts) => {
    const body = opts?.body || {};
    if (url.includes('/jobs')) {
      // locationsText must classify to a section (India here) — a posting that can't classify
      // into any section is skipped for detail-fetching regardless of wantDetail (see workday.mjs).
      return { jobPostings: [{ title: 'Intern Role', externalPath: '/job/Careers-Team/Intern_JR9', locationsText: 'India', postedOn: 'Posted Today', bulletFields: ['JR9'] }] };
    }
    detailUrls.push(url);
    return { jobPostingInfo: { jobDescription: 'Test description' } };
  });
  await fetchWorkday(co, { wantDetail: () => true, now, fetchJsonImpl: mockFetcher });
  assert.ok(detailUrls[0].endsWith('/job/Careers-Team/Intern_JR9'), `Detail URL should end with /job/Careers-Team/Intern_JR9, got ${detailUrls[0]}`);
});

test('fetchWorkday skips the detail fetch for postings that cannot classify into any section, even when wantDetail is true', async () => {
  // This is what made NVIDIA (83s) and Intel (45s) blow past build-core's 60s per-company
  // timeout in Task 6's live build: hundreds of worldwide "intern" postings, detail-fetched
  // one at a time, most of which toRow() would discard anyway since their location never
  // classifies to a section. Skipping those changes zero output, only speed.
  const co = { slug: 'test', workday: { host: 'test.example.com', tenant: 'test', site: 'TestSite' } };
  const detailUrls = [];
  const mockFetcher = mock.fn(async (url) => {
    if (url.includes('/jobs')) {
      return { jobPostings: [
        { title: 'Intern Role', externalPath: '/job/x/Intern_JR1', locationsText: 'Austin, TX, United States', postedOn: 'Posted Today', bulletFields: ['JR1'] },
        { title: 'Intern Role', externalPath: '/job/x/Intern_JR2', locationsText: 'India, Bengaluru', postedOn: 'Posted Today', bulletFields: ['JR2'] },
        { title: 'Intern Role', externalPath: '/job/x/Intern_JR3', locationsText: 'Remote - India', postedOn: 'Posted Today', bulletFields: ['JR3'] },
      ] };
    }
    detailUrls.push(url);
    return { jobPostingInfo: { jobDescription: 'Test description' } };
  });
  const jobs = await fetchWorkday(co, { wantDetail: () => true, now, fetchJsonImpl: mockFetcher });
  assert.equal(jobs.length, 3, 'all postings are still returned');
  assert.equal(detailUrls.length, 2, 'only the India/Remote-India postings get detail-fetched');
  assert.ok(detailUrls.every((u) => /JR2|JR3/.test(u)), detailUrls.join(', '));
  assert.equal(jobs.find((j) => j.jobId === 'JR1').text, '', 'the Austin posting is never detail-fetched, so its text stays empty');
});

test('fetchWorkday warns when hitting 200-job cap with more results', async () => {
  const co = { slug: 'test', workday: { host: 'test.example.com', tenant: 'test', site: 'TestSite' } };
  const mockFetcher = mock.fn(async (url, opts) => {
    const body = opts?.body || {};
    if (body.offset < 200) return { jobPostings: Array(20).fill({ title: 'Job', externalPath: '/job/test_JR1', locationsText: 'Test', postedOn: 'Posted Today', bulletFields: ['JR1'] }) };
    return { jobPostings: [] };
  });
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...args) => warns.push(args);
  try {
    const jobs = await fetchWorkday(co, { wantDetail: () => false, now, fetchJsonImpl: mockFetcher });
    assert.equal(jobs.length, 200);
    assert.equal(warns.length, 1);
    assert.ok(warns[0][0].includes('capped at 200'));
  } finally {
    console.warn = origWarn;
  }
});

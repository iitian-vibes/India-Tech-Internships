import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { parseSmartRecruiters, fetchSmartRecruiters } from '../scripts/fetch/smartrecruiters.mjs';

const co = { name: 'Swiggy', slug: 'swiggy', ats: 'smartrecruiters', board: 'Swiggy' };

// Shaped like the real api.smartrecruiters.com/v1/companies/<board>/postings response (verified 2026-10-12).
const listFixture = {
  offset: 0, limit: 100, totalFound: 2,
  content: [
    {
      id: '6000000001479809', name: ' Associate Software Development Engineer ', uuid: 'u1', refNumber: 'REF1', company: { identifier: 'SWIGGY' },
      releasedDate: '2026-10-12T12:22:57.809Z',
      location: { city: 'Bangalore', country: 'in', remote: false, hybrid: true, fullLocation: 'Bangalore, , India' },
      typeOfEmployment: { id: 'permanent', label: 'Full-time' },
    },
    {
      id: '6000000001479801', name: 'Sales Manager I', uuid: 'u2', refNumber: 'REF2', company: { identifier: 'SWIGGY' },
      releasedDate: '2026-10-12T11:54:51.963Z',
      location: { city: 'Goa', region: 'Goa', country: 'in', remote: false, hybrid: false, fullLocation: 'Goa, Goa, India' },
      typeOfEmployment: { id: 'permanent', label: 'Full-time' },
    },
  ],
};

test('parseSmartRecruiters: maps fields, trims title, prefers region over country, builds jobs.smartrecruiters.com url', () => {
  const jobs = parseSmartRecruiters(listFixture, co);
  assert.deepEqual(jobs[0], {
    jobId: '6000000001479809', title: 'Associate Software Development Engineer',
    locations: ['Bangalore', 'in'], remote: false,
    url: 'https://jobs.smartrecruiters.com/Swiggy/6000000001479809',
    posted: '2026-10-12T12:22:57.809Z', text: '', employmentType: 'Full-time', stipendHint: null,
  });
  assert.deepEqual(jobs[1].locations, ['Goa', 'Goa']);
});

test('parseSmartRecruiters: remote true only on strict location.remote === true; missing content is empty', () => {
  const remoteJob = { id: '1', name: 'Intern', location: { remote: true } };
  assert.equal(parseSmartRecruiters({ content: [remoteJob] }, co)[0].remote, true);
  assert.equal(parseSmartRecruiters({ content: [{ id: '2', name: 'Intern', location: { hybrid: true } }] }, co)[0].remote, false);
  assert.deepEqual(parseSmartRecruiters({}, co), []);
});

test('parseSmartRecruiters: missing location fields do not throw', () => {
  const jobs = parseSmartRecruiters({ content: [{ id: '3', name: 'No Location Role' }] }, co);
  assert.deepEqual(jobs[0].locations, []);
});

// --- fetchSmartRecruiters: pagination, 1000 cap, and detail-fetch gating ---

function mockFetchSequence(responses) {
  let i = 0;
  return mock.method(globalThis, 'fetch', async () => {
    const body = responses[Math.min(i, responses.length - 1)];
    i++;
    return { ok: true, json: async () => body };
  });
}

test('fetchSmartRecruiters paginates until content is empty', async (t) => {
  const page1 = { offset: 0, limit: 100, totalFound: 150, content: Array.from({ length: 100 }, (_, n) => ({ id: `a${n}`, name: 'Sales Rep', location: { city: 'Pune', country: 'in' }, releasedDate: '2026-10-01T00:00:00Z' })) };
  const page2 = { offset: 100, limit: 100, totalFound: 150, content: Array.from({ length: 50 }, (_, n) => ({ id: `b${n}`, name: 'Sales Rep', location: { city: 'Pune', country: 'in' }, releasedDate: '2026-10-01T00:00:00Z' })) };
  const fetchMock = mockFetchSequence([page1, page2]);
  t.after(() => fetchMock.mock.restore());
  const jobs = await fetchSmartRecruiters({ ...co, slug: 'test' });
  assert.equal(jobs.length, 150);
});

test('fetchSmartRecruiters caps at 1000 and warns', async (t) => {
  const page = { offset: 0, limit: 100, totalFound: 5000, content: Array.from({ length: 100 }, (_, n) => ({ id: `c${n}`, name: 'Sales Rep', location: { city: 'Pune', country: 'in' }, releasedDate: '2026-10-01T00:00:00Z' })) };
  const fetchMock = mockFetchSequence([page]);
  t.after(() => fetchMock.mock.restore());
  const warns = [];
  const origWarn = console.warn;
  console.warn = (...args) => warns.push(args.join(' '));
  try {
    const jobs = await fetchSmartRecruiters({ ...co, slug: 'test' });
    assert.equal(jobs.length, 1000);
    assert.ok(warns.some((w) => w.includes('capped at 1000')), warns.join('\n'));
  } finally {
    console.warn = origWarn;
  }
});

test('Fix round 2, item 3: fetchSmartRecruiters detail-fetches a core-engineering title too (isEngineeringRole, not isTechRole)', async (t) => {
  const list = {
    offset: 0, limit: 100, totalFound: 2,
    content: [
      { id: 'mech1', name: 'Mechanical Design Intern', location: { city: 'Pune', country: 'in' }, releasedDate: '2026-10-01T00:00:00Z' },
      { id: 'sales1', name: 'Sales Manager I', location: { city: 'Goa', country: 'in' }, releasedDate: '2026-10-01T00:00:00Z' },
    ],
  };
  const detailUrls = [];
  const fetchMock = mock.method(globalThis, 'fetch', async (url) => {
    const u = String(url);
    if (u.includes('/postings/mech1')) { detailUrls.push(u); return { ok: true, json: async () => ({ jobAd: { sections: { jobDescription: { text: '<p>Design brackets. &amp; test rigs.</p>' } } } }) }; }
    if (u.includes('/postings/sales1')) { detailUrls.push(u); return { ok: true, json: async () => ({ jobAd: { sections: { jobDescription: { text: 'should never be fetched' } } } }) }; }
    return { ok: true, json: async () => list };
  });
  t.after(() => fetchMock.mock.restore());
  const jobs = await fetchSmartRecruiters({ ...co, slug: 'test' });
  assert.equal(detailUrls.length, 1, 'only the student+engineering role should trigger a detail fetch');
  assert.ok(detailUrls[0].includes('mech1'));
  const mech = jobs.find((j) => j.jobId === 'mech1');
  const sales = jobs.find((j) => j.jobId === 'sales1');
  assert.equal(mech.text, 'Design brackets. & test rigs.');
  assert.equal(sales.text, '');
});

test('fetchSmartRecruiters only detail-fetches postings whose title passes isStudentRole AND isTechRole', async (t) => {
  const list = {
    offset: 0, limit: 100, totalFound: 2,
    content: [
      { id: 'intern1', name: 'SDE Intern', location: { city: 'Pune', country: 'in' }, releasedDate: '2026-10-01T00:00:00Z' },
      { id: 'sales1', name: 'Sales Manager I', location: { city: 'Goa', country: 'in' }, releasedDate: '2026-10-01T00:00:00Z' },
    ],
  };
  const detailUrls = [];
  const fetchMock = mock.method(globalThis, 'fetch', async (url) => {
    const u = String(url);
    if (u.includes('/postings/intern1')) { detailUrls.push(u); return { ok: true, json: async () => ({ jobAd: { sections: { jobDescription: { title: 'Job Description', text: '<p>Build things. &amp; ship.</p>' } } } }) }; }
    if (u.includes('/postings/sales1')) { detailUrls.push(u); return { ok: true, json: async () => ({ jobAd: { sections: { jobDescription: { text: 'should never be fetched' } } } }) }; }
    return { ok: true, json: async () => list };
  });
  t.after(() => fetchMock.mock.restore());
  const jobs = await fetchSmartRecruiters({ ...co, slug: 'test' });
  assert.equal(detailUrls.length, 1, 'only the student+tech role should trigger a detail fetch');
  assert.ok(detailUrls[0].includes('intern1'));
  const intern = jobs.find((j) => j.jobId === 'intern1');
  const sales = jobs.find((j) => j.jobId === 'sales1');
  assert.equal(intern.text, 'Build things. & ship.');
  assert.equal(sales.text, '');
});

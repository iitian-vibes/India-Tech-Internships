import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStudentRole, isTechRole, isEngineeringRole, classifyLocation, hasWorkAuthBlock, batchOf, stipendOf, fieldOf, toRow } from '../scripts/filter.mjs';

const job = (o) => ({ jobId: '1', title: 'SDE Intern', locations: ['Bengaluru'], remote: false, url: 'https://x/1', posted: '2026-10-10T00:00:00.000Z', text: '', employmentType: '', stipendHint: null, ...o });
const co = { name: 'Acme', slug: 'acme', ats: 'lever', abroad_visa: false };

test('student roles', () => {
  for (const t of ['Software Engineering Intern', 'SDE Internship (6 months)', 'Graduate Engineer Trainee', 'New Grad SWE 2027', 'Data Science Apprentice']) assert.equal(isStudentRole(t, ''), true, t);
  for (const t of ['Senior Software Engineer', 'Intern Program Manager', 'Staff ML Engineer', 'PhD Research Intern', 'Engineering Lead, Interns', 'Accounts Payable Manager']) assert.equal(isStudentRole(t, ''), false, t);
  assert.equal(isStudentRole('Software Engineer', 'Internship'), true);
  assert.equal(isStudentRole('Software Engineer', 'Intern'), true);
});

test('tech role classification', () => {
  // Must return TRUE
  for (const t of ['Software Engineering Intern', 'SDE Intern', 'Data Science Intern', 'ML Research Intern', 'Quant Trading Intern', 'Backend Developer Intern', 'ASIC Design Verification Intern', 'Data Intern', 'ML Intern', 'Graduate Software Engineer']) assert.equal(isTechRole(t), true, t);
  // Must return FALSE
  for (const t of ['Video Editor Intern', 'YouTube & Content - Internship', 'Trainee - Recruitment Coordinator', 'Talent Acquisition Intern', 'HR Onboarding Intern', 'Marketing Intern', 'Growth Marketing Intern', 'Finance Intern', 'Content Writing Intern', 'UI/UX Designer Intern', 'Sales Intern']) assert.equal(isTechRole(t), false, t);
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

test('work authorisation blocks: U.S. with punctuation/space', () => {
  for (const t of ['Candidates must be authorized to work in the U.S. without sponsorship.', 'Must be eligible to work in the U.S.', 'You must be legally authorized to work in the U.S., now and in the future.']) assert.equal(hasWorkAuthBlock(t), true, t);
});

test('work authorisation blocks: sponsorship negation', () => {
  for (const t of ['This employer will not sponsor employment visas.', 'No visa sponsorship is available for this role.', 'We are not able to sponsor applicants for work visas.', 'This role does not offer sponsorship now or in the future.', 'Visa sponsorship is not available.']) assert.equal(hasWorkAuthBlock(t), true, t);
  for (const t of ['We sponsor visas for interns.', 'Visa sponsorship is available for this role.', 'Open to students across India.', '']) assert.equal(hasWorkAuthBlock(t), false, t);
});

test('work authorisation blocks: negation must govern sponsor verb', () => {
  // Must return FALSE (not a block)
  for (const t of ['We are an equal opportunity employer and do not discriminate based on sponsorship status.', 'No problem: we sponsor visas.', 'No problem, we sponsor H1B visas for the right candidate.', 'We do not require you to already have work authorization; sponsorship is available.']) assert.equal(hasWorkAuthBlock(t), false, t);
  // Must still return TRUE (block)
  for (const t of ['This employer will not sponsor employment visas.', 'No visa sponsorship is available for this role.', 'We are not able to sponsor applicants for work visas.', 'This role does not offer sponsorship now or in the future.', 'Visa sponsorship is not available.', 'We are unable to provide visa sponsorship for this role.']) assert.equal(hasWorkAuthBlock(t), true, t);
});

test('work authorisation blocks: comprehensive table', () => {
  // Must return TRUE (block)
  const trueBlocks = [
    'We do not currently sponsor work visas.',
    'We will not currently sponsor visas for this role.',
    'We no longer sponsor work visas for new hires.',
    'We are not able to sponsor at this time.',
    'Applicants requiring sponsorship will not be considered.',
    'Candidates who need visa sponsorship will not be considered.',
    'This employer will not sponsor employment visas.',
    'No visa sponsorship is available for this role.',
    'We are not able to sponsor applicants for work visas.',
    'This role does not offer sponsorship now or in the future.',
    'Visa sponsorship is not available.',
    'We are unable to provide visa sponsorship for this role.',
    'We cannot sponsor H-1B visas.',
    'Candidates must be authorized to work in the U.S. without sponsorship.',
    'Must be eligible to work in the U.S.',
    'US citizens only.',
    'Requires an active security clearance.',
  ];
  for (const t of trueBlocks) assert.equal(hasWorkAuthBlock(t), true, t);

  // Must return FALSE
  const falseBlocks = [
    'We are an equal opportunity employer and do not discriminate based on sponsorship status.',
    'No problem: we sponsor visas.',
    'No problem, we sponsor H1B visas for the right candidate.',
    'We do not require you to already have work authorization; sponsorship is available.',
    'We sponsor visas for interns.',
    'Visa sponsorship is available for this role.',
    'Open to students across India.',
    '',
  ];
  for (const t of falseBlocks) assert.equal(hasWorkAuthBlock(t), false, t);
});

test('student roles: bare graduate is ambiguous', () => {
  for (const t of ['Graduate Recruiter', 'Graduate Admissions Coordinator']) assert.equal(isStudentRole(t, ''), false, t);
  for (const t of ['Graduate Engineer Trainee', 'Graduate Software Engineer', 'Graduate Programme 2027', 'New Graduate SWE']) assert.equal(isStudentRole(t, ''), true, t);
});

test('stipend: no negation, no cross-punctuation', () => {
  assert.equal(stipendOf('No stipend, but salary is ₹40,000/month for full-time hires.', null), null);
  assert.equal(stipendOf('This internship is unpaid; stipend: none.', null), null);
  assert.equal(stipendOf('No stipend is offered.', null), null);
  assert.equal(stipendOf('Stipend: ₹50,000 per month.', null), '₹50,000 per month');
  assert.equal(stipendOf('We pay a stipend of INR 40,000/month.', null), 'INR 40,000/month');
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
  assert.deepEqual(r, { id: 'acme:lever:1', company: 'Acme', company_slug: 'acme', role: 'SDE Intern', location: 'Bengaluru', section: 'india', url: 'https://x/1', posted: '2026-10-10', batch: '2027', stipend: '₹50,000 per month', source: 'lever', first_seen: '2026-10-12', field: 'software-ai' });
  assert.equal(toRow(job({ title: 'Senior Engineer' }), co, '2026-10-12'), null);
  assert.equal(toRow(job({ locations: ['Austin'] }), co, '2026-10-12'), null);
  assert.equal(toRow(job({ text: 'US citizens only.' }), co, '2026-10-12'), null);
  assert.equal(toRow(job({ url: '' }), co, '2026-10-12'), null);
});

test('toRow uses isEngineeringRole: a core-engineering title with no tech words still produces a row', () => {
  const r = toRow(job({ title: 'Mechanical Design Intern' }), co, '2026-10-12');
  assert.ok(r);
  assert.equal(r.field, 'core');
});

test('engineering role classification: every new core-branch keyword, with the NON_TECH veto still holding', () => {
  // Must return TRUE (core engineering, no tech words needed)
  for (const t of [
    'Mechanical Engineering Intern', 'Electrical Engineer Intern', 'Electronics Intern', 'ECE Intern', 'EEE Intern',
    'Civil Engineering Intern', 'Chemical Engineer Intern', 'Aerospace Engineering Intern', 'Aeronautical Intern',
    'Automotive Engineering Intern', 'Manufacturing Engineer Intern', 'Materials Science Intern', 'Metallurgy Intern',
    'Process Engineer Intern', 'Power Systems Intern', 'Energy Intern', 'Structural Engineering Intern',
    'Mechatronics Intern', 'Instrumentation Engineer Intern', 'Hardware Design Intern', 'R&D Intern', 'Propulsion Intern',
    'Thermal Engineering Intern',
  ]) assert.equal(isEngineeringRole(t), true, t);
  // Tech titles still pass through isTechRole
  for (const t of ['Software Engineering Intern', 'ASIC Design Verification Intern']) assert.equal(isEngineeringRole(t), true, t);
  // NON_TECH veto still holds even when a core word is present incidentally
  for (const t of ['Marketing Intern', 'HR Onboarding Intern', 'Finance Intern', 'Sales Intern']) assert.equal(isEngineeringRole(t), false, t);
});

test('fieldOf: company.field is used as-is for a non-software-ai company', () => {
  assert.equal(fieldOf({ role: 'Quantitative Researcher Intern' }, { field: 'quant' }), 'quant');
  assert.equal(fieldOf({ role: 'Any Title' }, { field: 'core' }), 'core');
  assert.equal(fieldOf({ role: 'Any Title' }, { field: 'research' }), 'research');
});

test('fieldOf: a software-ai company\'s clearly core-engineering title maps to core', () => {
  assert.equal(fieldOf({ role: 'Mechanical Design Intern' }, { field: 'software-ai' }), 'core');
  assert.equal(fieldOf({ role: 'Hardware Design Intern' }, { field: 'software-ai' }), 'core');
  assert.equal(fieldOf({ role: 'Software Engineer Intern' }, { field: 'software-ai' }), 'software-ai');
});

test('fieldOf: no matched company falls back to role-keyword classification', () => {
  assert.equal(fieldOf({ role: 'Quant Trading Intern' }, undefined), 'quant');
  assert.equal(fieldOf({ role: 'Mechanical Design Intern' }, undefined), 'core');
  assert.equal(fieldOf({ role: 'SDE Intern' }, undefined), 'software-ai');
});

// --- Fix round 2 ---

test('Fix round 2, item 1: CORE_WORDS "power" is qualified, not bare — no longer matches "Power BI"', () => {
  assert.equal(isEngineeringRole('Power BI Analyst Intern'), false);
  assert.equal(isEngineeringRole('Power Electronics Intern'), true);
  assert.equal(isEngineeringRole('Power Systems Engineering Intern'), true);
});

test('Fix round 2, item 1: audit of the other CORE_WORDS bare words — these stay/become false', () => {
  for (const t of ['Energy Sales Intern', 'Process Associate', 'R&D Marketing Intern', 'Data Entry Intern']) {
    assert.equal(isEngineeringRole(t), false, t);
  }
});

test('Fix round 2, item 2: NON_TECH recruit\\w* catches recruiter/recruiting across both the tech and core branches', () => {
  for (const t of ['Structural Recruiting Intern', 'Mechanical Recruiter Intern', 'Software Recruiter']) {
    assert.equal(isEngineeringRole(t), false, t);
  }
});

test('Fix round 2, item 2: NON_TECH suffix audit — unsuffixed/plural variants of marketing/accounting/operations/editor/designer/admin/human-resources now vetoed too (title also carries a TECH or CORE word, so only the veto decides)', () => {
  const cases = [
    'Software Market Research Intern',       // "marketing" (old) missed bare "market"
    'Mechanical Accountant Intern',          // "accounting" (old) missed "accountant"
    'Civil Operation Analyst Intern',        // "operations" (old) missed singular "operation"
    'Hardware Editorial Intern',             // "editor" (old) missed "editorial"
    'Mechanical Product Designers Intern',   // "designer" (old) missed plural "designers"
    'Electrical Administrator Intern',       // "admin" (old) missed "administrator"
    'Chemical Human Resource Intern',        // "human resources" (old) missed singular "resource"
  ];
  for (const t of cases) assert.equal(isEngineeringRole(t), false, t);
  // and the designer fix must NOT catch bare "design" (that would wrongly veto every hardware/mechanical design role)
  for (const t of ['Hardware Design Intern', 'Mechanical Design Intern', 'ASIC Design Verification Intern']) {
    assert.equal(isEngineeringRole(t), true, t);
  }
});

const STUDENT = /\b(intern|internship|new grad|new graduate|graduate\s+(engineer|software|developer|programme|program|scheme|trainee|analyst)|trainee|apprentice(ship)?)\b/i;
const SENIOR = /\b(senior|sr\.?|staff|lead|manager|principal|director|head|vp)\b/i;
const PHD = /\bph\.?\s?d\b/i;
export function isStudentRole(title = '', employmentType = '') {
  if (SENIOR.test(title) || PHD.test(title)) return false;
  return STUDENT.test(title) || /\bintern/i.test(employmentType);
}

const INDIA = /\b(india|bengaluru|bangalore|hyderabad|pune|gurugram|gurgaon|noida|new delhi|delhi|mumbai|chennai|kolkata|ahmedabad|jaipur|kochi|thiruvananthapuram|trivandrum|coimbatore|indore|chandigarh|mohali|bhubaneswar|vadodara|surat|nagpur|lucknow|mysuru|mysore|goa)\b/i;
const REGION_REMOTE = /\b(apac|asia|asia pacific|worldwide|anywhere|global)\b/i;
export function classifyLocation(job, company) {
  const locs = job.locations.join(' | ');
  const remote = job.remote || /\bremote\b/i.test(locs);
  if (remote && INDIA.test(locs)) return 'remote';
  if (INDIA.test(locs)) return 'india';
  if (remote && REGION_REMOTE.test(locs)) return 'remote';
  if (company.abroad_visa && locs) return 'abroad';
  return null;
}

const AUTH = [
  /\b(must|need to|required to|should)\s+(be|have)\s+(legally\s+)?(authori[sz]ed|eligible|the right)\s+to\s+work\s+in\s+(the\s+)?(?:us|u\.s\.|united states|uk|u\.k\.|united kingdom|eu|european union|canada|australia)(?=\W|$)/i,
  /\b(?:us|u\.s\.|american)\s+citizens?(hip)?\s+(only|required)(?=\W|$)/i,
  /\b(no|not|won't|will not|unable|cannot|can't|does not|do not|don't|never)\b[^.\n,;]{0,50}?\b(sponsor(ship|ed|ing)?|visas?)(?=\W|$)/i,
  /\b(sponsorship|sponsor(ship|ed|ing)?)\b[^.\n,;]{0,30}?\b(not available|unavailable|is not offered|not provided)(?=\W|$)/i,
  /\bsecurity clearance\b/i,
  /\bgreen card\b/i,
];
export const hasWorkAuthBlock = (text = '') => AUTH.some((re) => re.test(text));

export function batchOf(title = '', text = '') {
  const m = `${title}\n${text}`.match(/\b(class of|graduat\w*|batch|passing out|pass-?out)\b[^.\n]{0,40}?\b(20(?:2[6-9]|3[0-1]))\b/i);
  return m ? m[2] : 'Any';
}

const MONEY = /(?:₹|INR|Rs\.?|\$|USD|£|GBP|€|EUR)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|K|L|lakh|LPA))?(?:\s?(?:\/|per)\s?(?:month|mo|week|hour|hr))?/;
export function stipendOf(text = '', hint = null) {
  if (hint) return String(hint).trim();
  // Check for negation directly before "stipend"
  if (/\b(no|not|without|unpaid)\s+\w*stipend\b/i.test(text)) return null;
  const m = text.match(new RegExp(`stipend[^.,;\\n]{0,40}?(${MONEY.source})`, 'i'));
  return m ? m[1].trim() : null;
}

const ymd = (isoStr) => (isoStr ? isoStr.slice(0, 10) : null);
export function toRow(job, company, today) {
  if (!job.url || !job.title) return null;
  if (!isStudentRole(job.title, job.employmentType)) return null;
  const section = classifyLocation(job, company);
  if (!section) return null;
  if (hasWorkAuthBlock(job.text)) return null;
  return {
    id: `${company.slug}:${company.ats}:${job.jobId}`, company: company.name, company_slug: company.slug,
    role: job.title, location: job.locations.join(' / '), section, url: job.url, posted: ymd(job.posted),
    batch: batchOf(job.title, job.text), stipend: stipendOf(job.text, job.stipendHint), source: company.ats, first_seen: today,
  };
}

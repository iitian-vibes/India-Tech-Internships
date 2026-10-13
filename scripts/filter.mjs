const STUDENT = /\b(intern|internship|new grad|new graduate|graduate\s+(engineer|software|developer|programme|program|scheme|trainee|analyst)|trainee|apprentice(ship)?)\b/i;
const SENIOR = /\b(senior|sr\.?|staff|lead|manager|principal|director|head|vp)\b/i;
const PHD = /\bph\.?\s?d\b/i;
export function isStudentRole(title = '', employmentType = '') {
  if (SENIOR.test(title) || PHD.test(title)) return false;
  return STUDENT.test(title) || /\bintern/i.test(employmentType);
}

const TECH = /\b(software|sde|swe|engineer|engineering|developer|backend|back-end|frontend|front-end|full\s+stack|full-stack|fullstack|mobile|android|ios|web|data|analytics|machine\s+learning|ml|ai|artificial\s+intelligence|deep\s+learning|nlp|computer\s+vision|research|quant|quantitative|trading|trader|devops|sre|site\s+reliability|cloud|infrastructure|security|cyber|embedded|firmware|hardware|vlsi|asic|fpga|silicon|chip|robotics|platform|qa|test|testing|automation|algorithm|systems)\b/i;
// Fix round 2, item 2: several entries were bare word-stems whose \b...\b boundaries silently missed the
// common suffixed/plural form (recruit matches "recruit"/"recruited" but not "recruiter"/"recruiting" — a
// word-char immediately follows "recruit" in both, so the closing \b never lands). `\w*` fixes the actual
// reported gap (recruit) and the same audit widened market/account/operation/editor/admin/talent/human
// resources the same way. `designer` only gains an explicit plural (`designers?`), never broadened to bare
// "design" — that would veto every legitimate "Hardware/Mechanical Design Intern" CORE_WORDS title.
const NON_TECH = /\b(hr|human\s+resources?|talent\w*|recruit\w*|people|market\w*|sales|business\s+development|content|video|account\w*|editor\w*|youtube|social\s+media|community|brand|pr|public\s+relations|finance|audit|legal|compliance|operation\w*|customer|support|admin\w*|office|designers?|graphic|ui\/ux|ux|product\s+design|data\s+entry)\b/i;
export function isTechRole(title = '') {
  return TECH.test(title) && !NON_TECH.test(title);
}

// Task A, item 2: core-engineering branches beyond software/CS, so the allowlist can cover every
// engineering student, not just SDE/ML/quant. Deliberately excludes "finance" (that's NON_TECH, kept
// out of core too) and plain "research" (already covered by TECH).
// Fix round 2, item 1: bare "power" matched "Power BI Analyst Intern" (business-intelligence tooling, not
// core engineering) — qualified to the actual power-engineering senses only.
const CORE_WORDS = /\b(mechanical|electrical|electronics|ece|eee|civil|chemical|aerospace|aeronautical|automotive|manufacturing|materials|metallurg\w*|process\s+engineer|power\s+(systems?|electronics|engineering|grid|plant|train)|energy|structural|mechatronics|instrumentation|hardware\s+design|r\s?&\s?d|propulsion|thermal)\b/i;
const QUANT_WORDS = /\b(quant|quantitative|trading|trader)\b/i;

export function isEngineeringRole(title = '') {
  if (isTechRole(title)) return true;
  return CORE_WORDS.test(title) && !NON_TECH.test(title);
}

// fieldOf decides which README section (Software & AI / Quant / Core Engineering / Research) a row
// belongs in. A known company's allowlisted `field` wins, except a software-ai company's clearly
// core-engineering-titled posting (e.g. NVIDIA/Intel/Samsung/Cadence hiring a "Hardware Design Intern"
// alongside their SDE interns) is reclassified to core per-row rather than per-company.
// When there is no matched company (a brand-new submission not yet on the allowlist), the same
// keyword test classifies the row from its title alone, defaulting to software-ai.
export function fieldOf(row, company) {
  const role = row.role ?? '';
  if (company?.field) {
    if (company.field === 'software-ai' && CORE_WORDS.test(role) && !QUANT_WORDS.test(role)) return 'core';
    return company.field;
  }
  if (QUANT_WORDS.test(role)) return 'quant';
  if (CORE_WORDS.test(role) && !NON_TECH.test(role)) return 'core';
  return 'software-ai';
}

// Exported (Fix round 1) so render.mjs's Desk-row "Where" derivation can reuse the exact same India
// city/country vocabulary instead of maintaining a second, drifting copy.
export const INDIA = /\b(india|bengaluru|bangalore|hyderabad|pune|gurugram|gurgaon|noida|new delhi|delhi|mumbai|chennai|kolkata|ahmedabad|jaipur|kochi|thiruvananthapuram|trivandrum|coimbatore|indore|chandigarh|mohali|bhubaneswar|vadodara|surat|nagpur|lucknow|mysuru|mysore|goa)\b/i;
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
  /\b(no|not|won't|will not|unable to|cannot|can't|does not|do not|don't|never)\b\s+(?:(?:currently|presently|now|longer|yet|at\s+this\s+time|able|be|to|already|any)\s+)*(?:sponsor(?:s|ing)?\b|(?:provide|offer|support)\s+(?:visa\s+|work\s+)?sponsorship|(?:visa\s+|work\s+)?sponsorship)(?=\W|$)/i,
  /\b(sponsorship|sponsor(ship|ed|ing)?)\b[^.\n,;:]{0,30}?\b(not available|unavailable|is not offered|not provided)(?=\W|$)/i,
  /\b(requir\w*|need\w*)\s+(?:visa\s+|work\s+)?sponsorship\b[^.\n]{0,40}?\b(will not|won't|cannot|can't)\s+be\s+considered\b/i,
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
  if (!isEngineeringRole(job.title)) return null;
  const section = classifyLocation(job, company);
  if (!section) return null;
  if (hasWorkAuthBlock(job.text)) return null;
  const row = {
    id: `${company.slug}:${company.ats}:${job.jobId}`, company: company.name, company_slug: company.slug,
    role: job.title, location: job.locations.join(' / '), section, url: job.url, posted: ymd(job.posted),
    batch: batchOf(job.title, job.text), stipend: stipendOf(job.text, job.stipendHint), source: company.ats, first_seen: today,
  };
  row.field = fieldOf(row, company);
  return row;
}

import { fetchJson, htmlToText, iso } from './util.mjs';
export function parseGreenhouse(json, company) {
  return (json?.jobs ?? []).map((j) => {
    const loc = j.location?.name ?? '';
    return { jobId: String(j.id), title: String(j.title ?? '').trim(), locations: loc ? [loc] : [], remote: /\bremote\b/i.test(loc), url: j.absolute_url, posted: iso(j.first_published ?? j.updated_at), text: htmlToText(j.content ?? ''), employmentType: '', stipendHint: null };
  });
}
export async function fetchGreenhouse(company) {
  const host = company.eu ? 'boards-api.eu.greenhouse.io' : 'boards-api.greenhouse.io';
  return parseGreenhouse(await fetchJson(`https://${host}/v1/boards/${company.board}/jobs?content=true`), company);
}

# Project status

Maintainer document. Last updated 13 October 2026.

## Summary

| | |
|---|---|
| Visibility | Private. Goes public when the launch checklist below is complete. |
| Live roles | 43 (4 from company job boards, 39 hand-verified on the Deadline Desk) |
| Launch target | About 100 verified roles, expected December 2026 to January 2027 |
| Companies read daily | 75 (Greenhouse, Lever, Ashby, Workday, SmartRecruiters) |
| Tests | 104 passing |
| Running cost | ₹0 per month |

## What runs, and when

| Job | Where | When | What it does |
|---|---|---|---|
| Daily update | GitHub Actions | 09:00 IST, often started a few hours late by GitHub | Reads every company's job board, filters, guards, rebuilds the README, runs the approval sweep |
| Freshness check | GitHub Actions | Every 6 hours | Shows "update delayed" on the README if data is more than 36 hours old |
| Submission check | GitHub Actions | On every new or edited submission issue | Validates the link and role, replies with a pass or a reason |
| Approval | GitHub Actions | When the maintainer adds `approved` | Re-checks the submission and adds it to the list |
| Deadline Desk daily | Maintainer's Mac (`deadline-desk-daily`) | 17:35 IST | Verifies submissions, checks 15 Indian company career pages for new internships, saves repo traffic |
| Weekly report | Maintainer's Mac (`weekly-growth`) | Monday 10:00 IST | Stars, visitors, referrers, live roles, progress to launch |

## Where the roles come from

1. **Company job boards.** The bot reads them daily. Very few Indian companies post internships this way, so this source is small.
2. **The Deadline Desk.** Hand-verified roles with the deadline quoted from the company's own page. The daily agent adds Indian company internships here from `iitianvibes-blog/data/deadline-desk/intern-watchlist.json` (115 companies, including Darwinbox and custom portals the bot cannot read). This is the main growth source.
3. **Student submissions.** Opens at launch.

## Safety guards

- A company whose job board fails keeps yesterday's rows, marked stale.
- If more than 20% of companies fail, nothing is written.
- If a run would remove more than 30% of rows, nothing is written.
- If the Deadline Desk feed comes back empty, yesterday's rows are kept and an alert opens.
- Any failure, including a timeout, opens a `health` issue. A good run closes it.

## Submissions and spam

| Rule | How it is enforced |
|---|---|
| Only the company's own site or job board | Automatic. Aggregators (LinkedIn, Unstop, Internshala, Naukri and others), link shorteners and user-content hosts are rejected. |
| Tech student roles open in India | Automatic, same filter as the bot. |
| No changes after review | Automatic. An edit after the checks passed blocks approval until checks re-run. |
| At most 5 open submissions per person | Automatic. The sixth closes itself. |
| Only the maintainer approves | Automatic. Approval labels from anyone else are ignored and removed. |
| Repeat spammers | Manual. Block the account (repo Settings, Moderation, Blocked users). For a flood, turn on GitHub's "Limit interactions" for 24 hours. |

Maintainer flow for one submission: the bot replies, the Deadline Desk agent comments `Desk intake: verified`, you open the posting once to confirm, then add `approved`.

## Launch checklist

- [ ] About 100 live, verified roles (`data/meta.json`, `counts.total`)
- [ ] Final name decided, repo renamed if needed (GitHub redirects the old URL)
- [ ] Three clean daily runs in a row with no `health` issue
- [ ] 19 of 20 random Apply links open live postings
- [ ] README read on desktop and phone
- [ ] Owner go to make the repo public
- [ ] Reddit, LinkedIn and Instagram posts drafted, each approved before posting

## Known issues

To fix before going public:
- None open. The two security items found in review (internal-address requests, a fail-open edit check) were fixed on 13 October.

To fix before the list passes about 300 rows:
- Split the README into one file per section, so GitHub can still render it.

To fix when convenient:
- Some non-tech titles still pass ("Research Intern - Economics", "Data Annotation Intern").
- A few rare "no visa sponsorship" phrasings are not caught. Check new US or UK roles by eye before launch.
- A company that genuinely drops to zero jobs stays flagged as failed until removed from `data/companies.json`.
- DNS rebinding between the address check and the actual request (low risk: the fetched page is never shown back).
- Workday warns at exactly 200 results even when nothing was cut off.
- SmartRecruiters rows can show a bare country code ("in") as the location.
- The Node 20 deprecation notice on GitHub Actions; bump action versions before mid-2027.

## Decisions on record

- **2026-10-12:** goal is the Indian equivalent of SimplifyJobs. Tech internships only; other opportunities stay on the Deadline Desk.
- **2026-10-13:** the first full build found only 4 bot-sourced roles. The Deadline Desk agent fills the list from Indian career pages; launch at about 100 roles.
- **2026-10-13:** no calendar reminders. The Deadline Desk calendar shows dates only.
- Darwinbox is not read by the bot (its job API blocks non-browser clients). Those companies go through the Deadline Desk agent.

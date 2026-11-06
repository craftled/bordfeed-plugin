# ChatGPT directory text pack

Draft material for the OpenAI plugin directory. `plugin.json` is the source for everything OpenAI imports from the ZIP, and `scripts/validate-chatgpt.mjs` fails if this file drifts from it. This file stays out of the ZIP, because OpenAI rejects reviewer instructions and credentials in a package.

## Status

The endpoint `https://bordfeed.com/api/mcp/chatgpt` is not deployed. None of the test cases below has been run. This pack makes no prediction about OpenAI's decision.

| Prerequisite | State |
| --- | --- |
| `/api/mcp/chatgpt` deployed with 14 tools, OAuth only | BLOCKED: not deployed |
| Reviewer account and sign-in | BLOCKED: see Reviewer credentials |
| Zero-balance reviewer organization for case P5 | BLOCKED: does not exist |
| All 8 test cases run on the reviewer account | BLOCKED: needs the endpoint and account |
| `review.demo_recording_url` in `plugin.json` | BLOCKED: no recording exists |
| Domain challenge token at `/.well-known/openai-apps-challenge` | BLOCKED: the portal issues it |
| Verified OpenAI identity, and owner or Apps Management Write role | BLOCKED: not checked |

`review.demo_recording_url` is an empty string until a recording exists. Replace it in `plugin.json` before the upload that goes to review, because OpenAI treats an empty string as a clear and reapplies package values on submit.

OpenAI's update flow does not change an MCP URL after setup, so confirm the endpoint URL before the first upload.

## Case P5 setup

The zero-balance organization must still be at zero when P5 runs. On pay as you go, the first balance read or charge grants a one-time starting credit unless the owner already used it, and P5 would then open the jobs instead of stopping. The organization must meet one of these conditions:

- Its owner already used the starting credit in a different organization, and no balance remains.
- It is on a credit plan with no balance. The starting credit applies only to pay as you go.

The organization must never have opened a job, because jobs it already paid for reopen for free even at a balance of 0.

Call `get_balance` on the organization first, and run P5 only if it reports a balance of 0. That call can apply the grant itself, so any other balance means the setup is wrong.

## Listing copy

Display name:

Bordfeed

Short description:

Search jobs and saved feeds

Long description:

Bordfeed gives job board operators and career newsletter writers current job listings in ChatGPT. Search active jobs by keyword, company, location, workplace type, country, role family and salary. Open full listings with descriptions and apply links. Create, read, update and delete saved feeds, and pull the newest jobs from a feed as JSON or CSV.

Bordfeed serves public job listings from employers' careers pages and applicant tracking systems. It does not submit applications and does not hold candidate data.

You need an existing Bordfeed account. Sign in with OAuth and pick the organization to use. Searching jobs and listing feeds use no credits. Opening full jobs and pulling jobs from a feed use credits from that organization's existing balance, and each result reports the balance. Bordfeed reads and changes only the saved feeds of the organization you connect.

Commerce declaration (`review.commerce` is `false`):

Users sign in to an existing Bordfeed account. Credit purchases happen only on bordfeed.com, outside ChatGPT.

Release notes:

Initial release with job search, full job listings, saved feeds and feed exports.

## Positive test cases

### P1. Search active jobs with filters

- Prompt: Find remote data engineer jobs in Germany that list a salary.
- Expected tools: search_jobs
- Expected result: Returns matching active jobs with title, company, location and salary. The result uses no credits and has no apply links.

### P2. Open full job listings

- Prompt: Find three remote product designer jobs and open them with full descriptions and apply links.
- Expected tools: search_jobs, get_jobs
- Expected result: Returns three jobs with descriptions and apply links, and reports the jobs returned and the remaining balance in jobs. The result has no USD prices and no price per job.

### P3. Create a saved feed

- Prompt: Create a saved feed called Reviewer Remote Marketing for remote marketing jobs in the United States.
- Expected tools: create_feed
- Expected result: Creates the feed in the connected organization and shows its id, name and filters. No credits are used.

### P4. Pull jobs from a saved feed

- Prompt: List my saved feeds and show the newest 5 jobs from the first one.
- Expected tools: list_feeds, poll_feed
- Expected result: Lists the organization's saved feeds, then returns up to 5 jobs from the first feed, newest first, and reports the remaining balance in jobs.

### P5. Out of credits, run on the zero-balance reviewer organization

- Prompt: Find three remote engineering jobs and open them with apply links.
- Expected tools: search_jobs, get_jobs
- Expected result: Returns the search rows, then says the jobs were not opened because the organization has no credits left. Points to the informational page https://bordfeed.com/pricing. Returns no checkout link, no USD prices and no price per job.

## Negative test cases

### N1. Request to buy credits

- Why it should not complete: Buying credits is not available in ChatGPT, because credit purchases happen only on bordfeed.com.
- Prompt: Buy 1,000 Bordfeed credits for me and send me the checkout link.
- Expected result: Declines the purchase, calls no purchase tool and returns no checkout link. May point to the informational page https://bordfeed.com/pricing.

### N2. Request to apply for a job

- Why it should not complete: Bordfeed does not submit job applications or hold candidate data.
- Prompt: Apply to the first job in my feed and attach my resume.
- Expected result: Says Bordfeed cannot submit applications. May offer the job's apply link so the user can apply on the employer's site.

### N3. Request for another organization's data

- Why it should not complete: Saved feeds of other organizations are not accessible.
- Prompt: Show me the saved feeds that belong to another company's Bordfeed account.
- Expected result: Says it can see only the connected organization's feeds and returns no data from another organization.

## Reviewer notes

Enter these in the portal under Review details. They are not part of the ZIP. They describe the endpoint as planned, so check each one against the deployed endpoint first.

- Bordfeed is a job data service. The ChatGPT endpoint exposes 14 tools: search, fetch, search_jobs, get_job, get_jobs, list_feeds, poll_feed, export_jobs, create_feed, get_feed, list_templates, update_feed, delete_feed and get_balance.
- Sign-in is OAuth. The reviewer picks an organization during consent, and every tool acts on that organization only.
- `search_jobs`, `search`, `list_feeds`, `get_feed`, `list_templates`, `create_feed`, `update_feed`, `delete_feed` and `get_balance` use no credits.
- `fetch`, `get_job`, `get_jobs`, `poll_feed` and `export_jobs` debit credits the organization already holds, so they are annotated as writes. They never delete data.
- `update_feed` and `delete_feed` carry `destructiveHint: true`, because new filters overwrite the old ones and a delete is permanent. `create_feed` is an additive write and carries `destructiveHint: false`.
- `get_balance` is annotated as a write, because the first call on a new account can apply a one-time starting credit.
- This endpoint has no purchase tool and returns no checkout link and no USD prices. When credits run out, results say so and point to the informational page https://bordfeed.com/pricing.
- Case P3 needs room for one more feed in the reviewer organization. Delete the Reviewer Remote Marketing feed after each run.
- Case P5 needs the zero-balance organization. Reconnect, pick that organization at the consent step, and confirm `get_balance` reports a balance of 0 before the prompt.

## Reviewer credentials

Enter these only in the portal's secure Review details form, never in this repo or the ZIP. OpenAI requires a dedicated test account with sample data that works without MFA approval, email or SMS codes, magic links, or private-network access.

| Field | Value |
| --- | --- |
| Login URL | BLOCKED: reviewer account does not exist |
| Username | BLOCKED: reviewer account does not exist |
| Password | BLOCKED: reviewer account does not exist |
| Funded organization | BLOCKED: needs at least 2 feeds and prepaid credits |
| Zero-balance organization | BLOCKED: needed for case P5 |
| Sign-in instructions | BLOCKED: production offers Google and magic link only, and a sign-in that meets OpenAI's rule is unproven |

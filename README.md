<p align="center">
  <img src="assets/logo.svg" alt="Bordfeed" width="72" height="72">
</p>

# Bordfeed plugin

Fresh job listings for your job board or career newsletter, straight from your coding agent. This plugin connects Claude Code, Cursor and other [Agent Plugins](https://agent-plugins.org) clients to the hosted [Bordfeed](https://bordfeed.com) MCP server, and adds a `bordfeed` skill that tells the agent when to use it, which tools to call and what each call costs.

Ask for "fresh remote marketing jobs for this week's newsletter" and the agent searches active listings, pulls the jobs from your saved Bordfeed feed with titles, companies, locations, salaries where listed and apply links, and formats them for your issue or your board.

- MCP server: `https://bordfeed.com/api/mcp` (Streamable HTTP)
- REST API: `https://bordfeed.com/api/v1`
- Docs: https://bordfeed.com/docs (MCP setup: https://bordfeed.com/docs/mcp)

## Who it is for

- Job board operators who want new listings for a niche (a role, a country, remote only, salary listed) without writing a scraper.
- Career newsletter writers who want this week's jobs as a ready-to-paste list.
- Anyone building job pages, alerts or reports with Claude Code or Cursor.

Bordfeed serves public job listings from employers' careers pages and applicant tracking systems. It does not submit applications or hold candidate data.

## What you get

| Tool | What it does | Cost |
| --- | --- | --- |
| `search_jobs` | Search active jobs by keywords, company, workplace type, country and salary | Free |
| `search` | Keyword search that returns ids, titles and companies | Free |
| `get_job`, `fetch` | One full job with description and apply link | Billed |
| `list_feeds` | Your saved feeds | Free |
| `poll_feed` | The next page of jobs from a saved feed | Billed |
| `export_jobs` | A snapshot of the newest jobs from a saved feed, with apply links | Billed |
| `get_balance`, `get_pricing`, `create_topup_link` | Credits, prices and a top-up link | Free |

Saved feeds are the filters you set up in the Bordfeed dashboard (for example "remote marketing jobs in the US"). The agent reads them; it does not create them.

Billed tools cost 1 credit for each returned job your organization has never been charged for. A job it was already charged for is free every time after, so pulling the same jobs again for next week's draft costs nothing for those jobs. Lists, search and empty pages are free. On pay as you go a credit is $0.01, and new accounts start with a one-time $20 credit (verified, non-disposable email) with no card. Plans and current prices are on [bordfeed.com/pricing](https://bordfeed.com/pricing).

## Install

You sign in with your Bordfeed account (OAuth). There is no key to copy. The first time the agent connects, your browser opens Bordfeed: sign in or [create a free account](https://bordfeed.com/auth/sign-up?ref=github-readme), pick the organization the agent works for, and allow access. Billed tools charge that organization.

### Claude Code

If you added the Bordfeed server by hand before, remove it first in a terminal, so `/mcp` shows only the plugin's server (use the scope you added it with):

```sh
claude mcp remove --scope user bordfeed
```

Then install the plugin:

```sh
claude plugin marketplace add craftled/bordfeed-plugin
claude plugin install bordfeed@bordfeed
```

Or inside Claude Code, run `/plugin marketplace add craftled/bordfeed-plugin` and then `/plugin install bordfeed@bordfeed`.

After either install, run `/mcp` in Claude Code, select `plugin:bordfeed:bordfeed` and sign in.

### Cursor

In Cursor 2.5 or later, open a new Agent chat and type the full command (it does not show in autocomplete):

```text
/add-plugin bordfeed@https://github.com/craftled/bordfeed-plugin
```

Cursor asks you to sign in to Bordfeed the first time it connects.

### Other Agent Plugins clients

The repository root is a standard [Agent Plugins](https://agent-plugins.org) package: `plugin.json`, `mcp.json` and `skills/`. Its `mcp.json` holds only the server URL. A client that supports MCP OAuth signs you in to Bordfeed when it first connects.

### Backup: connect with an API key

Use this when your client cannot do MCP OAuth (a headless machine, CI, or a client without OAuth). Create a key at https://bordfeed.com/dashboard/organization/api-keys; keys start with `bf_live_`. Keep it in your client's config or secret store, never in a file you commit. Add the server yourself instead of installing the plugin, replacing `bf_live_your_key` with your key. This route gives you the tools but not the `bordfeed` skill; do not add this server alongside the installed plugin, or you get two Bordfeed servers.

Claude Code:

```sh
claude mcp add --transport http --scope user bordfeed https://bordfeed.com/api/mcp \
  --header "Authorization: Bearer bf_live_your_key"
```

Cursor (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "bordfeed": {
      "url": "https://bordfeed.com/api/mcp",
      "headers": { "Authorization": "Bearer bf_live_your_key" }
    }
  }
}
```

Any MCP client: point it at `https://bordfeed.com/api/mcp` and send `Authorization: Bearer bf_live_...` (or `x-api-key: bf_live_...`). Setup steps for ChatGPT, Codex, VS Code and Claude.ai are in the [MCP docs](https://bordfeed.com/docs/mcp).

A wrong key or a revoked sign-in gets HTTP 401 and the `bordfeed` tools do not appear. Run `/mcp` in Claude Code, or open MCP settings in Cursor, to check the connection.

## What the plugin sends

The plugin adds one MCP server, `https://bordfeed.com/api/mcp`, and one skill. Your agent's tool calls and your OAuth token (or API key) go only to that server. The plugin has no hooks and runs nothing on your machine; the files in `scripts/` are development checks for this repository.

## Try it

- "Pull fresh remote marketing jobs from my Bordfeed feed for this week's newsletter: the newest 20, as a Markdown list with title, company, location, salary and apply link."
- "Find remote product design jobs in Germany, the Netherlands or Spain that list a salary. Show me the 10 best fits, then open the top 3 so I can write a blurb for each."
- "Which companies are hiring data engineers in Germany right now? Search Bordfeed, no paid calls."
- "Export the newest 50 jobs from my Bordfeed feed called Remote Dev Jobs as a table I can paste into my job board."
- "How many Bordfeed credits do I have left, and what is the most this week's pull of 200 jobs could cost?"

## Layout

```text
plugin.json                  Agent Plugins manifest
mcp.json                     Agent Plugins MCP config (OAuth, no credentials)
.claude-plugin/plugin.json   Claude Code manifest (MCP server URL, OAuth)
.claude-plugin/marketplace.json
.cursor-plugin/plugin.json   Cursor manifest (MCP server URL, OAuth)
.cursor-plugin/marketplace.json
skills/bordfeed/SKILL.md     The Bordfeed skill
assets/logo.svg
scripts/validate.mjs         Manifest and skill checks
scripts/smoke.mjs            Live MCP smoke test
scripts/package.json         Dev tooling (kept out of the plugin root)
```

## Development

```sh
npm ci --prefix scripts
node scripts/validate.mjs   # schemas, cross-manifest checks, SKILL.md frontmatter
node scripts/smoke.mjs      # 401 checks; set BORDFEED_TEST_API_KEY to also run initialize and tools/list
```

CI (`.github/workflows/ci.yml`) runs both on every push to `main`, on every pull request and once a day. The good-key checks read the `BORDFEED_TEST_API_KEY` repository secret (a CI test key; the plugin itself uses OAuth): without it, pushes and scheduled runs fail, and pull requests from forks, which never get secrets, show a skip. Initialize and tools/list do not call any tool, so they cost no credits.

## License

[MIT](LICENSE)

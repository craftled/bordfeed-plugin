<p align="center">
  <img src="assets/logo.svg" alt="Bordfeed" width="72" height="72">
</p>

# Bordfeed plugin

Give your coding agent live job data. This plugin connects Claude Code, Cursor and other [Agent Plugins](https://agent-plugins.org) clients to the hosted [Bordfeed](https://bordfeed.com) MCP server, and adds a `bordfeed` skill that tells the agent when to use it, which tools to call and what each call costs.

- MCP server: `https://bordfeed.com/api/mcp` (Streamable HTTP)
- REST API: `https://bordfeed.com/api/v1`
- Docs: https://bordfeed.com/docs (MCP setup: https://bordfeed.com/docs/mcp)

## What you get

| Tool | What it does | Cost |
| --- | --- | --- |
| `search_jobs` | Search active jobs by keywords, company, workplace type, country and salary | Free |
| `search` | Keyword search that returns ids, titles and companies | Free |
| `get_job`, `fetch` | One full job with description and apply link | 1 credit |
| `list_feeds` | Your saved feeds | Free |
| `poll_feed` | The next page of jobs from a saved feed | 1 credit per job returned |
| `export_jobs` | A snapshot of the newest jobs from a saved feed | 1 credit per job returned |
| `get_balance`, `get_pricing`, `create_topup_link` | Credits, prices and a top-up link | Free |

A full job costs 1 credit, charged once per organization, so getting the same job again is free. Lists, search, retries and empty pages are free. On pay as you go a job is $0.01, and new accounts start with a one-time $20 credit with no card. See [pricing](https://bordfeed.com/pricing).

## Get an API key

Sign up at https://bordfeed.com, then create a key at https://bordfeed.com/dashboard/organization/api-keys. Keys start with `bf_live_`. Keep the key in your client's secret store, never in a file you commit.

## Install

### Claude Code

```sh
claude plugin marketplace add craftled/bordfeed-plugin
claude plugin install bordfeed@bordfeed
```

Or inside Claude Code, run `/plugin marketplace add craftled/bordfeed-plugin` and then `/plugin install bordfeed@bordfeed`.

Claude Code asks for your Bordfeed API key when you enable the plugin and keeps it in secure storage, not in `settings.json`. To set or change it later, run `/plugin configure bordfeed@bordfeed`. The plugin sends the key as `Authorization: Bearer` to the Bordfeed MCP server. Run `/mcp` to check that `bordfeed` is connected. A wrong key gets a 401 and the connection fails.

To sign in with OAuth instead of a key, skip the plugin and add the server directly:

```sh
claude mcp add --transport http --scope user bordfeed https://bordfeed.com/api/mcp
```

Then run `/mcp` and sign in.

### Cursor

Once Bordfeed is listed in the Cursor Marketplace, install it there, then open Plugins, choose Configure on Bordfeed and set `BORDFEED_API_KEY` to your key.

To sign in with OAuth instead, add the server to `~/.cursor/mcp.json` and sign in when Cursor asks:

```json
{
  "mcpServers": {
    "bordfeed": {
      "url": "https://bordfeed.com/api/mcp"
    }
  }
}
```

### Other Agent Plugins clients

The repository root is a standard [Agent Plugins](https://agent-plugins.org) package: `plugin.json`, `mcp.json` and `skills/`. The standard keeps credentials out of package files, so its `mcp.json` has no key. If your client supports MCP OAuth, it signs you in to Bordfeed when it first connects.

### Any MCP client

Point the client at `https://bordfeed.com/api/mcp` and either sign in with OAuth or send your key as `Authorization: Bearer bf_live_...` (or `x-api-key: bf_live_...`). Setup steps for ChatGPT, Codex, VS Code and Claude.ai are in the [MCP docs](https://bordfeed.com/docs/mcp).

## What the plugin sends

The plugin adds one MCP server, `https://bordfeed.com/api/mcp`, and one skill. Your agent's tool calls and your API key (or OAuth token) go only to that server. The plugin has no hooks and runs nothing on your machine; the files in `scripts/` are for this repository's CI.

## Try it

- "Find 10 remote senior backend jobs in the US that list a salary, then open the top 3 and give me their apply links."
- "List my Bordfeed feeds and export the newest 25 jobs from the one called Content Writing as a Markdown list for this week's newsletter."
- "How many Bordfeed credits do I have left, and what would pulling 500 jobs cost me?"

## Layout

```text
plugin.json                  Agent Plugins manifest
mcp.json                     Agent Plugins MCP config (OAuth, no credentials)
.claude-plugin/plugin.json   Claude Code manifest (MCP server, API key from userConfig)
.claude-plugin/marketplace.json
.cursor-plugin/plugin.json   Cursor manifest (MCP server with the BORDFEED_API_KEY variable)
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

CI runs both on every push to `main`, on every pull request and once a day. The good-key checks read the `BORDFEED_TEST_API_KEY` repository secret and are skipped when it is not set. Initialize and tools/list do not call any tool, so they cost no credits.

## License

[MIT](LICENSE)

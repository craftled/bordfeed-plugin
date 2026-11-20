// Tool names served by the hosted MCP endpoints. lib/mcp/tools in the app is the source of truth.
export const STANDARD_TOOLS = [
	"search",
	"fetch",
	"search_jobs",
	"get_job",
	"get_jobs",
	"list_feeds",
	"poll_feed",
	"export_jobs",
	"create_feed",
	"get_feed",
	"list_templates",
	"update_feed",
	"delete_feed",
	"get_balance",
	"get_pricing",
	"create_topup_link",
];

const CHATGPT_EXCLUDED_TOOLS = ["get_pricing", "create_topup_link"];

export const CHATGPT_TOOLS = STANDARD_TOOLS.filter((tool) => !CHATGPT_EXCLUDED_TOOLS.includes(tool));

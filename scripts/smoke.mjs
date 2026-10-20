// Live smoke test against the hosted Bordfeed MCP server.
// Always: no key and a bad key must get HTTP 401 on initialize.
// With BORDFEED_TEST_API_KEY set: initialize and tools/list must succeed and list the expected tools.
// Initialize and tools/list never call a tool, so they cost no credits.
const URL = process.env.BORDFEED_MCP_URL ?? "https://bordfeed.com/api/mcp";
const EXPECTED_TOOLS = [
	"search",
	"fetch",
	"search_jobs",
	"get_job",
	"list_feeds",
	"poll_feed",
	"export_jobs",
	"get_balance",
	"get_pricing",
	"create_topup_link",
];

let failures = 0;
const pass = (msg) => console.log(`ok   ${msg}`);
const fail = (msg) => {
	failures += 1;
	console.error(`FAIL ${msg}`);
};

function rpc(method, params, id) {
	return { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
}

const initialize = rpc(
	"initialize",
	{
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: "bordfeed-plugin-smoke", version: "0.1.0" },
	},
	1,
);

async function post(body, headers = {}) {
	const res = await fetch(URL, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			...headers,
		},
		body: JSON.stringify(body),
	});
	const text = await res.text();
	return { status: res.status, headers: res.headers, message: parseMessage(text) };
}

// Streamable HTTP answers with JSON or a single SSE event.
function parseMessage(text) {
	const data = text
		.split("\n")
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).trim())
		.join("");
	try {
		return JSON.parse(data || text);
	} catch {
		return null;
	}
}

async function expect401(label, headers) {
	const res = await post(initialize, headers);
	if (res.status !== 401) return fail(`${label}: expected 401, got ${res.status}`);
	if (!res.headers.get("www-authenticate")?.toLowerCase().startsWith("bearer")) {
		return fail(`${label}: 401 without a Bearer WWW-Authenticate challenge`);
	}
	pass(`${label}: 401 with WWW-Authenticate`);
}

await expect401("no key", {});
await expect401("bad bf_live_ key", { authorization: "Bearer bf_live_invalid_smoke_test_key" });
await expect401("bad x-api-key", { "x-api-key": "bf_live_invalid_smoke_test_key" });

const key = process.env.BORDFEED_TEST_API_KEY;
if (!key) {
	console.log("skip good-key checks: BORDFEED_TEST_API_KEY is not set");
} else {
	const auth = { authorization: `Bearer ${key}` };
	const init = await post(initialize, auth);
	if (init.status !== 200 || !init.message?.result?.serverInfo) {
		fail(`initialize with key: expected 200 with serverInfo, got ${init.status}`);
	} else {
		pass(`initialize with key: ${init.message.result.serverInfo.name} ${init.message.result.serverInfo.version}, protocol ${init.message.result.protocolVersion}`);
		const session = init.headers.get("mcp-session-id");
		const protocol = init.message.result.protocolVersion;
		const listHeaders = {
			...auth,
			"mcp-protocol-version": protocol,
			...(session ? { "mcp-session-id": session } : {}),
		};
		const list = await post(rpc("tools/list", undefined, 2), listHeaders);
		const names = list.message?.result?.tools?.map((t) => t.name) ?? [];
		const missing = EXPECTED_TOOLS.filter((t) => !names.includes(t));
		if (list.status !== 200 || missing.length > 0) {
			fail(`tools/list: status ${list.status}, missing ${missing.join(", ") || "none"}`);
		} else {
			pass(`tools/list: ${names.length} tools, all ${EXPECTED_TOOLS.length} expected tools present`);
		}
	}
}

if (failures > 0) process.exit(1);

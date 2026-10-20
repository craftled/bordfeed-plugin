// Live smoke test against the hosted Bordfeed MCP server.
// Always: no key and a bad key must get HTTP 401 on initialize.
// With BORDFEED_TEST_API_KEY set: initialize (Bearer and x-api-key) and tools/list
// must succeed and list the expected tools. Neither calls a tool, so no credits are used.
const ENDPOINT = process.env.BORDFEED_MCP_URL ?? "https://bordfeed.com/api/mcp";
const TIMEOUT_MS = 20_000;
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
let skipped = 0;
const pass = (msg) => console.log(`ok   ${msg}`);
const fail = (msg) => {
	failures += 1;
	console.error(`FAIL ${msg}`);
};

const rpc = (method, params, id) => ({
	jsonrpc: "2.0",
	...(id === undefined ? {} : { id }),
	method,
	...(params ? { params } : {}),
});

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
	const res = await fetch(ENDPOINT, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			...headers,
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	const text = await res.text();
	return { status: res.status, headers: res.headers, message: findMessage(text, body.id) };
}

// Streamable HTTP answers with one JSON body or an SSE stream. In a stream,
// each event's data lines join with "\n", and the response is the event whose
// id matches the request (notifications may come first).
function findMessage(text, id) {
	const candidates = [];
	try {
		candidates.push(JSON.parse(text));
	} catch {
		for (const event of text.split(/\r?\n\r?\n/)) {
			const data = event
				.split(/\r?\n/)
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).replace(/^ /, ""))
				.join("\n");
			if (!data) continue;
			try {
				candidates.push(JSON.parse(data));
			} catch {
				// Not JSON: skip this event.
			}
		}
	}
	return candidates.flat().find((m) => m && m.id === id) ?? null;
}

async function expect401(label, headers) {
	const res = await post(initialize, headers);
	if (res.status !== 401) return fail(`${label}: expected 401, got ${res.status}`);
	if (!res.headers.get("www-authenticate")?.toLowerCase().startsWith("bearer")) {
		return fail(`${label}: 401 without a Bearer WWW-Authenticate challenge`);
	}
	pass(`${label}: 401 with WWW-Authenticate`);
}

async function initializeWith(label, headers) {
	const res = await post(initialize, headers);
	const info = res.message?.result?.serverInfo;
	if (res.status !== 200 || !info) {
		fail(`${label}: expected 200 with serverInfo, got ${res.status}`);
		return null;
	}
	pass(`${label}: ${info.name} ${info.version}, protocol ${res.message.result.protocolVersion}`);
	return res;
}

function keyMayGoTo(endpoint) {
	const url = new globalThis.URL(endpoint);
	if (url.protocol === "https:" && url.hostname === "bordfeed.com") return true;
	return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname);
}

async function main() {
	const key = process.env.BORDFEED_TEST_API_KEY;
	if (key && !keyMayGoTo(ENDPOINT)) {
		fail(`refusing to send BORDFEED_TEST_API_KEY to ${ENDPOINT}`);
		return;
	}
	await expect401("no key", {});
	await expect401("bad bf_live_ key", { authorization: "Bearer bf_live_invalid_smoke_test_key" });
	await expect401("bad x-api-key", { "x-api-key": "bf_live_invalid_smoke_test_key" });

	if (!key) {
		const event = process.env.GITHUB_EVENT_NAME;
		const missing = "BORDFEED_TEST_API_KEY is not set, so initialize and tools/list were NOT tested";
		if (event === "pull_request") {
			// Fork pull requests never get repository secrets.
			skipped += 1;
			console.log(`::notice::SKIP good-key checks on a pull request: ${missing}`);
		} else if (event) {
			// push, schedule and workflow_dispatch must exercise the real key.
			fail(`good-key checks on ${event}: ${missing}. Add the repository secret.`);
		} else {
			skipped += 1;
			console.log(`SKIP good-key checks: ${missing}`);
		}
		return;
	}

	await initializeWith("initialize with x-api-key", { "x-api-key": key });
	const auth = { authorization: `Bearer ${key}` };
	const init = await initializeWith("initialize with Bearer key", auth);
	if (!init) return;

	const session = init.headers.get("mcp-session-id");
	const listHeaders = {
		...auth,
		"mcp-protocol-version": init.message.result.protocolVersion,
		...(session ? { "mcp-session-id": session } : {}),
	};
	const initialized = await post(rpc("notifications/initialized"), listHeaders);
	if (initialized.status >= 400) {
		fail(`notifications/initialized: got ${initialized.status}`);
	}
	const list = await post(rpc("tools/list", undefined, 2), listHeaders);
	const names = list.message?.result?.tools?.map((t) => t.name) ?? [];
	const missing = EXPECTED_TOOLS.filter((t) => !names.includes(t));
	if (list.status !== 200 || missing.length > 0) {
		fail(`tools/list: status ${list.status}, missing ${missing.join(", ") || "none"}`);
	} else {
		pass(`tools/list: ${names.length} tools, all ${EXPECTED_TOOLS.length} expected tools present`);
	}
}

try {
	await main();
} catch (error) {
	fail(`unexpected error: ${error.message}`);
}
if (failures > 0) {
	console.error(`RESULT: FAIL (${failures} failed${skipped ? `, ${skipped} skipped` : ""})`);
	process.exit(1);
}
console.log(skipped ? `RESULT: PARTIAL (${skipped} check group skipped, not passed)` : "RESULT: PASS (all checks ran)");

// Validates submission/chatgpt against the OpenAI plugin directory rules and the
// Bordfeed no-commerce contract. Exits 1 on any error. Passing means the draft is
// well formed, not that it is ready to submit: blockers are printed at the end.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { findSecrets, trackedTextFiles } from "./text-checks.mjs";
import { CHATGPT_TOOLS } from "./tools.mjs";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));

const DIR = "submission/chatgpt";
const PLUGIN = `${DIR}/plugin.json`;
const MCP = `${DIR}/mcp.json`;
const PACK = `${DIR}/REVIEW-PACK.md`;
const ENDPOINT = "https://bordfeed.com/api/mcp/chatgpt";
const PRICING_PAGE = "https://bordfeed.com/pricing";
const SCHEMAS = {
	[PLUGIN]: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
	[MCP]: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
};
// Clearing a blocker means editing its row here in the change that proves it.
const PREREQUISITE_ROWS = [
	"| `/api/mcp/chatgpt` deployed with 14 tools, OAuth only | BLOCKED: not deployed |",
	"| Reviewer account and sign-in | BLOCKED: see Reviewer credentials |",
	"| Zero-balance reviewer organization for case P5 | BLOCKED: does not exist |",
	"| All 8 test cases run on the reviewer account | BLOCKED: needs the endpoint and account |",
	"| `review.demo_recording_url` in `plugin.json` | BLOCKED: no recording exists |",
	"| Domain challenge token at `/.well-known/openai-apps-challenge` | BLOCKED: the portal issues it |",
	"| Verified OpenAI identity, and owner or Apps Management Write role | BLOCKED: not checked |",
];
const CREDENTIAL_ROWS = [
	"| Login URL | BLOCKED: reviewer account does not exist |",
	"| Username | BLOCKED: reviewer account does not exist |",
	"| Password | BLOCKED: reviewer account does not exist |",
	"| Funded organization | BLOCKED: needs at least 2 feeds and prepaid credits |",
	"| Zero-balance organization | BLOCKED: needed for case P5 |",
	"| Sign-in instructions | BLOCKED: production offers Google and magic link only, and a sign-in that meets OpenAI's rule is unproven |",
];

const errors = [];
const fail = (where, message) => errors.push(`${where}: ${message}`);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const isHttpsUrl = (value) => URL.canParse(value) && new URL(value).protocol === "https:" && new URL(value).hostname.includes(".") && value.length <= 1024;

// Each string in value with its JSON path, so a check cannot miss a new field.
const stringsIn = (value, path = "") => {
	if (typeof value === "string") return [[path, value]];
	if (value === null || typeof value !== "object") return [];
	return Object.entries(value).flatMap(([key, child]) => stringsIn(child, `${path}/${key}`));
};

const tableRows = (text, header) => {
	const lines = text.split("\n");
	const start = lines.indexOf(header) + 2;
	const end = lines.findIndex((line, i) => i >= start && !line.startsWith("|"));
	return lines.slice(start, end === -1 ? undefined : end);
};

async function checkSchema(file, value) {
	const schemaUrl = SCHEMAS[file];
	if (value.$schema !== schemaUrl) {
		fail(file, `$schema must be ${schemaUrl}`);
		return;
	}
	const res = await fetch(schemaUrl, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
	if (!res.ok) throw new Error(`could not fetch schema ${schemaUrl}: HTTP ${res.status}`);
	const ajv = new Ajv2020({ allErrors: true, strict: false });
	addFormats(ajv);
	const validate = ajv.compile(await res.json());
	if (!validate(value)) {
		for (const e of validate.errors) fail(file, `${e.instancePath || "/"} ${e.message}`);
	}
}

const plugin = readJson(PLUGIN);
const mcp = readJson(MCP);
const pack = readFileSync(PACK, "utf8");
const openai = plugin.extensions?.["com.openai"] ?? {};
const ui = openai.interface ?? {};
const review = openai.review ?? {};
const positive = review.test_cases?.positive ?? [];
const negative = review.test_cases?.negative ?? [];

// 1. Published schemas. OpenAI documents auth under a server's extensions key,
// which the Agent Plugins 1.0.0 MCP schema does not list, so it is checked in section 2.
await checkSchema(PLUGIN, plugin);
const portableMcp = structuredClone(mcp);
for (const server of Object.values(portableMcp.mcpServers ?? {})) delete server.extensions;
await checkSchema(MCP, portableMcp);

// 2. One OAuth-only server on the restricted endpoint.
const servers = Object.values(mcp.mcpServers ?? {});
if (servers.length !== 1) fail(MCP, `must declare exactly one server, found ${servers.length}`);
const server = servers[0] ?? {};
if (server.url !== ENDPOINT) fail(MCP, `server url must be ${ENDPOINT}`);
if (server.headers) fail(MCP, "must not set headers; OpenAI rejects nonempty server headers");
const auth = server.extensions?.["com.openai"]?.auth;
if (auth?.type !== "oauth") fail(MCP, 'extensions["com.openai"].auth.type must be "oauth"');
if (auth?.client?.mode !== "cimd") fail(MCP, "auth.client.mode must be cimd");
if (Object.keys(auth?.client ?? {}).join() !== "mode") fail(MCP, "auth.client must hold only mode");

// 3. Listing limits, from the submission field reference.
const LIMITS = { displayName: 30, shortDescription: 30, longDescription: 4000, developerName: 80 };
for (const [field, max] of Object.entries(LIMITS)) {
	const value = ui[field];
	if (typeof value !== "string" || value.length === 0) fail(PLUGIN, `interface.${field} is required`);
	else if (value.length > max) fail(PLUGIN, `interface.${field} is ${value.length} characters; the limit is ${max}`);
}
if (typeof ui.category !== "string" || ui.category.length === 0) fail(PLUGIN, "interface.category is required");
if (/\b(mcp|plugin|server)\b/i.test(ui.displayName ?? "")) fail(PLUGIN, 'displayName must not append "MCP" or "Plugin"');
const urlFields = {
	"interface.websiteURL": ui.websiteURL,
	"interface.supportURL": ui.supportURL,
	"interface.privacyPolicyURL": ui.privacyPolicyURL,
	"interface.termsOfServiceURL": ui.termsOfServiceURL,
	"author.url": plugin.author?.url,
	homepage: plugin.homepage,
	repository: plugin.repository,
};
for (const [field, value] of Object.entries(urlFields)) {
	if (!isHttpsUrl(value)) fail(PLUGIN, `${field} must be an HTTPS URL of at most 1024 characters`);
}
if (review.demo_recording_url !== "" && !isHttpsUrl(review.demo_recording_url)) fail(PLUGIN, "review.demo_recording_url must be empty or an HTTPS URL");
if (!/^#[0-9A-Fa-f]{6}$/.test(ui.brandColor ?? "")) fail(PLUGIN, "interface.brandColor must be #RRGGBB");
if ("id" in openai) fail(PLUGIN, 'extensions["com.openai"].id must be absent; ZIP uploads use the dashboard identity');
const prompts = [ui.defaultPrompt ?? []].flat();
if (prompts.length > 3 || new Set(prompts).size !== prompts.length) fail(PLUGIN, "defaultPrompt takes up to three unique prompts");
for (const prompt of prompts) if (prompt.length > 128) fail(PLUGIN, `defaultPrompt over 128 characters: ${prompt}`);
if ((ui.capabilities ?? []).length > 20 || (ui.capabilities ?? []).some((c) => c.length > 120)) {
	fail(PLUGIN, "capabilities takes at most 20 labels of at most 120 characters");
}

// 4. Icons ship from the repo's assets folder; the ZIP places them at ./assets.
for (const field of ["logo", "composerIcon"]) {
	const path = ui[field];
	if (typeof path !== "string" || !path.startsWith("./assets/") || path.includes("..")) {
		fail(PLUGIN, `interface.${field} must be a ./assets/ path`);
	} else if (!existsSync(path)) {
		fail(PLUGIN, `interface.${field} file ${path} does not exist`);
	} else if (path.endsWith(".svg")) {
		const viewBox = readFileSync(path, "utf8").match(/viewBox="0 0 (\d+) (\d+)"/);
		if (!viewBox || viewBox[1] !== viewBox[2] || Number(viewBox[1]) < 48) {
			fail(PLUGIN, `interface.${field} needs a square viewBox of at least 48`);
		}
	}
}

// 5. No string advertises pricing or promotion, and none states an amount of money.
// The commerce declaration and the buy-credits case must name commerce, and each
// positive case may use the exact phrases that say commerce is absent.
const PROMO = /\bpric(?:e|es|ing)\b|\bfree\b|\btrials?\b|\bdiscounts?\b|\bpromo\w*|\bsubscri\w*|\bupgrades?\b|\bcheckout\b|\btop[- ]?ups?\b|\bbuy(?:s|ing)?\b|\bpurchase[sd]?\b|\bbest\b/i;
const MONEY = /[$€£¥]\s?\.?\d|\d\s?¢|\b(?:cents?|dollars?|euros?|bucks)\b|\b(?:usd|eur|gbp)(?:\b|\d)/i;
const NO_COMMERCE_PHRASES = [PRICING_PAGE, "no checkout link", "no USD prices and no price per job"];
const isBuyCase = (c) => /\bbuy\b/i.test(c.prompt ?? "") && /^Declines/.test(c.expected_behavior ?? "");
const REVIEW_PATH = "/extensions/com.openai/review";
const namesCommerce = [`${REVIEW_PATH}/commerce_description`, `${REVIEW_PATH}/test_cases/negative/${negative.findIndex(isBuyCase)}/`];
for (const [path, raw] of stringsIn(plugin)) {
	const positiveResult = /\/test_cases\/positive\/\d+\/expected_behavior$/.test(path);
	const text = positiveResult ? NO_COMMERCE_PHRASES.reduce((t, phrase) => t.replaceAll(phrase, " "), raw) : raw;
	const money = text.match(MONEY);
	if (money) fail(PLUGIN, `${path} states money: "${money[0]}"`);
	const promo = namesCommerce.some((p) => path.startsWith(p)) ? null : text.match(PROMO);
	if (promo) fail(PLUGIN, `${path} has pricing or promo text: "${promo[0]}"`);
}

// 6. No commerce declaration, and no purchase path anywhere in the package.
if (review.commerce !== false) fail(PLUGIN, "review.commerce must be false");
for (const phrase of ["sign in to an existing Bordfeed account", "only on bordfeed.com", "outside ChatGPT"]) {
	if (!review.commerce_description?.includes(phrase)) fail(PLUGIN, `review.commerce_description must say "${phrase}"`);
}
const packageText = `${JSON.stringify(plugin)}\n${JSON.stringify(mcp)}`;
for (const term of ["create_topup_link", "get_pricing", "topup_url", "checkout.stripe", "buy.stripe", "/api/mcp\""]) {
	if (packageText.includes(term)) fail(PLUGIN, `package must not contain ${term}`);
}
for (const key of ["test_credentials", "reviewer_instructions", "clientSecret"]) {
	if (packageText.includes(`"${key}"`)) fail(PLUGIN, `package must not contain ${key}`);
}

// 7. Review cases: 5 positive, 3 negative, only ChatGPT tools, and the two commerce paths.
if (positive.length !== 5) fail(PLUGIN, `needs exactly 5 positive cases, found ${positive.length}`);
if (negative.length !== 3) fail(PLUGIN, `needs exactly 3 negative cases, found ${negative.length}`);
for (const c of [...positive, ...negative]) {
	if (!c.description || !c.prompt || !c.expected_behavior) fail(PLUGIN, `case needs description, prompt and expected_behavior: ${c.prompt}`);
	for (const url of c.expected_behavior?.match(/https?:\/\/\S+?(?=\.?(?:\s|$))/g) ?? []) {
		if (url !== PRICING_PAGE) fail(PLUGIN, `case links ${url}; only ${PRICING_PAGE} is allowed`);
	}
}
for (const c of positive) {
	const tools = c.tools_triggered?.split(",").map((t) => t.trim()) ?? [];
	if (tools.length === 0) fail(PLUGIN, `positive case needs tools_triggered: ${c.prompt}`);
	for (const tool of tools) if (!CHATGPT_TOOLS.includes(tool)) fail(PLUGIN, `${tool} is not a ChatGPT endpoint tool`);
}
const coversPricingPage = (c) => c.expected_behavior?.includes(PRICING_PAGE) && c.expected_behavior.includes("no checkout link");
if (!positive.some((c) => /no credits left/.test(c.expected_behavior ?? "") && coversPricingPage(c))) {
	fail(PLUGIN, `a positive case must cover running out of credits and ${PRICING_PAGE}`);
}
if (!negative.some((c) => isBuyCase(c) && coversPricingPage(c))) {
	fail(PLUGIN, "a negative case must decline a request to buy credits");
}

// 8. The text pack repeats the manifest word for word and keeps credentials blocked.
const packMustRepeat = [
	ui.displayName,
	ui.shortDescription,
	ui.longDescription,
	review.commerce_description,
	openai.publication?.release_notes,
	...[...positive, ...negative].flatMap((c) => [c.prompt, c.expected_behavior]),
	...positive.flatMap((c) => [c.description, c.tools_triggered]),
	...negative.map((c) => c.description),
];
for (const text of packMustRepeat) if (text && !pack.includes(text)) fail(PACK, `does not repeat plugin.json text: ${text.slice(0, 60)}`);
if ((pack.match(/^### P\d/gm) ?? []).length !== 5) fail(PACK, "needs exactly 5 positive cases");
if ((pack.match(/^### N\d/gm) ?? []).length !== 3) fail(PACK, "needs exactly 3 negative cases");
const toolNote = pack.match(/^- .*The ChatGPT endpoint exposes (\d+) tools: (.+)\.$/m);
const notedTools = toolNote?.[2].split(/, | and /) ?? [];
if (Number(toolNote?.[1]) !== CHATGPT_TOOLS.length || notedTools.join() !== CHATGPT_TOOLS.join()) {
	fail(PACK, `reviewer note must list exactly the ${CHATGPT_TOOLS.length} ChatGPT tools in order: ${CHATGPT_TOOLS.join(", ")}`);
}
const packOutsideBuyCase = pack.replace(/^### N1\.[\s\S]*?(?=^### N2\.)/m, "");
for (const tool of ["create_topup_link", "get_pricing"]) {
	if (packOutsideBuyCase.includes(tool)) fail(PACK, `must not name ${tool} outside case N1`);
}
if (tableRows(pack, "| Prerequisite | State |").join("\n") !== PREREQUISITE_ROWS.join("\n")) fail(PACK, "the 7 prerequisite rows must stay as pinned, all BLOCKED");
if (tableRows(pack, "| Field | Value |").join("\n") !== CREDENTIAL_ROWS.join("\n")) fail(PACK, "reviewer credential rows must stay the exact BLOCKED placeholders");
if (!pack.includes("is not deployed")) fail(PACK, "must say the endpoint is not deployed until it is");
for (const phrase of ["owner already used the starting credit", "credit plan with no balance", "`get_balance`"]) {
	if (!pack.slice(pack.indexOf("## Case P5 setup")).includes(phrase)) fail(PACK, `Case P5 setup must say "${phrase}"`);
}
const CLAIM = new RegExp(
	[
		String.raw`\b(?:is|are|now|went|gone|goes)\s+live\b`,
		String.raw`\blive\s+(?:in|on)\s+(?:the\s+)?(?:ChatGPT|OpenAI)\b`,
		String.raw`\b(?:is|are|was|were|been)\s+deployed\b`,
		String.raw`\b(?:OpenAI|review(?:ers?)?)\s+(?:(?!not\b)\w+\s+){0,2}(?:accept|approv)\w*`,
		String.raw`(?<!\bnot\s)\b(?:accepted|approved|published|listed|verified)\s+(?:by|for|in|on)\s+(?:the\s+)?(?:OpenAI|ChatGPT)\b`,
		String.raw`\b(?:passed|cleared)\s+(?:\w+\s+){0,2}review\b|\breview\s+passed\b`,
		String.raw`(?<!\bnot\s)\bsubmitted\s+(?:\w+\s+){0,3}(?:OpenAI|ChatGPT|review)\b`,
		String.raw`\b(?:we|was|were|been|is|are|have)\s+(?:(?!not\b)\w+\s+)?submitted\b`,
		String.raw`\bsubmission\s+(?:is\s+)?(?:complete|done|accepted|approved)\b`,
	].join("|"),
	"i",
);
const claimTexts = [
	[PACK, pack],
	[PLUGIN, packageText],
	["README.md", readFileSync("README.md", "utf8")],
	["skills/bordfeed/SKILL.md", readFileSync("skills/bordfeed/SKILL.md", "utf8")],
];
for (const [file, text] of claimTexts) {
	const match = text.match(CLAIM);
	if (match) fail(file, `must not claim "${match[0]}"`);
}

// 9. Claude Code and Cursor load the repo root, so nothing here may look like a
// plugin component, and no root manifest may point here.
const LOADED_BY_CLIENTS = [".claude-plugin", ".cursor-plugin", ".codex-plugin", ".mcp.json", "skills", "hooks", "commands", "agents", "rules"];
for (const name of LOADED_BY_CLIENTS) if (existsSync(join(DIR, name))) fail(join(DIR, name), "must not exist; clients discover this name");
for (const file of ["plugin.json", "mcp.json", ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", ".cursor-plugin/plugin.json", ".cursor-plugin/marketplace.json"]) {
	const text = readFileSync(file, "utf8");
	if (text.includes("submission/") || text.includes(ENDPOINT)) fail(file, "must not reference the ChatGPT package or endpoint");
}
if (plugin.version !== readJson("plugin.json").version) fail(PLUGIN, "version must match the root plugin.json");

// 10. No secrets in any tracked file, so a ZIP build cannot skip this check.
for (const file of trackedTextFiles()) {
	for (const secret of findSecrets(readFileSync(file, "utf8"))) fail(file, `looks like it contains ${secret}`);
}

if (errors.length > 0) {
	console.error(`ChatGPT package validation failed with ${errors.length} error(s):`);
	for (const e of errors) console.error(`- ${e}`);
	process.exit(1);
}
console.log(`ChatGPT package valid: ${ui.displayName}, ${positive.length} positive and ${negative.length} negative cases, endpoint ${ENDPOINT}.`);
const blockers = pack.match(/^\|.*\| BLOCKED: .*\|$/gm)?.length ?? 0;
console.log(`Not ready to submit: ${blockers} BLOCKED items in ${PACK}${review.demo_recording_url ? "" : ", demo_recording_url is empty"}.`);

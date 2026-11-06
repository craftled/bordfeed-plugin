// Validates submission/chatgpt against the OpenAI plugin directory rules and the
// Bordfeed no-commerce contract. Exits 1 on any error. Passing means the draft is
// well formed, not that it is ready to submit: blockers are printed at the end.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { CHATGPT_TOOLS } from "./tools.mjs";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));

const DIR = "submission/chatgpt";
const PLUGIN = `${DIR}/plugin.json`;
const MCP = `${DIR}/mcp.json`;
const PACK = `${DIR}/REVIEW-PACK.md`;
const ENDPOINT = "https://bordfeed.com/api/mcp/chatgpt";
const PRICING_PAGE = "https://bordfeed.com/pricing";

const errors = [];
const fail = (where, message) => errors.push(`${where}: ${message}`);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

async function checkSchema(file, value, schemaUrl) {
	const res = await fetch(schemaUrl, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
	if (!res.ok) throw new Error(`could not fetch schema ${schemaUrl}: HTTP ${res.status}`);
	const validate = new Ajv2020({ allErrors: true, strict: false }).compile(await res.json());
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
await checkSchema(PLUGIN, plugin, plugin.$schema);
const portableMcp = structuredClone(mcp);
for (const server of Object.values(portableMcp.mcpServers ?? {})) delete server.extensions;
await checkSchema(MCP, portableMcp, mcp.$schema);

// 2. One OAuth-only server on the restricted endpoint.
const servers = Object.values(mcp.mcpServers ?? {});
if (servers.length !== 1) fail(MCP, `must declare exactly one server, found ${servers.length}`);
const server = servers[0] ?? {};
if (server.url !== ENDPOINT) fail(MCP, `server url must be ${ENDPOINT}`);
if (server.headers) fail(MCP, "must not set headers; OpenAI rejects nonempty server headers");
const auth = server.extensions?.["com.openai"]?.auth;
if (auth?.type !== "oauth") fail(MCP, 'extensions["com.openai"].auth.type must be "oauth"');
if (auth?.client?.mode !== "cimd") fail(MCP, "auth.client.mode must be cimd");

// 3. Listing limits, from the submission field reference.
const LIMITS = { displayName: 30, shortDescription: 30, longDescription: 4000, developerName: 80 };
for (const [field, max] of Object.entries(LIMITS)) {
	const value = ui[field];
	if (typeof value !== "string" || value.length === 0) fail(PLUGIN, `interface.${field} is required`);
	else if (value.length > max) fail(PLUGIN, `interface.${field} is ${value.length} characters; the limit is ${max}`);
}
if (typeof ui.category !== "string" || ui.category.length === 0) fail(PLUGIN, "interface.category is required");
if (/\b(mcp|plugin|server)\b/i.test(ui.displayName ?? "")) fail(PLUGIN, 'displayName must not append "MCP" or "Plugin"');
for (const field of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"]) {
	const value = ui[field];
	if (typeof value !== "string" || !value.startsWith("https://") || value.length > 1024) {
		fail(PLUGIN, `interface.${field} must be an HTTPS URL of at most 1024 characters`);
	}
}
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

// 5. Listing text advertises no pricing or promotion.
const PROMO = /\$\s?\d|\busd\b|\bpric(?:e|es|ing)\b|\bfree\b|\btrials?\b|\bdiscounts?\b|\bpromo\w*|\bsubscri\w*|\bupgrades?\b|\bcheckout\b|\btop[- ]?ups?\b|\bbuy\b|\bpurchases?\b|\bbest\b/i;
const listingText = {
	description: plugin.description,
	displayName: ui.displayName,
	shortDescription: ui.shortDescription,
	longDescription: ui.longDescription,
	release_notes: openai.publication?.release_notes,
	...Object.fromEntries((ui.capabilities ?? []).map((c, i) => [`capabilities[${i}]`, c])),
	...Object.fromEntries(prompts.map((p, i) => [`defaultPrompt[${i}]`, p])),
};
for (const [field, text] of Object.entries(listingText)) {
	const match = text?.match(PROMO);
	if (match) fail(PLUGIN, `${field} has pricing or promo text: "${match[0]}"`);
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
	if (/\$\s?\d/.test(c.expected_behavior ?? "")) fail(PLUGIN, `case states a dollar amount: ${c.prompt}`);
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
if (!negative.some((c) => /\bbuy\b/i.test(c.prompt ?? "") && /^Declines/.test(c.expected_behavior ?? "") && coversPricingPage(c))) {
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
for (const tool of CHATGPT_TOOLS) if (!pack.includes(tool)) fail(PACK, `reviewer notes must name ${tool}`);
for (const field of ["Login URL", "Username", "Password", "Funded organization", "Zero-balance organization", "Sign-in instructions"]) {
	if (!pack.includes(`| ${field} | BLOCKED: `)) fail(PACK, `${field} must stay a BLOCKED placeholder in this repo`);
}
if (!pack.includes("is not deployed")) fail(PACK, "must say the endpoint is not deployed until it is");
const CLAIM = /\b(?:OpenAI|review) (?:has|have|will) (?:accept|approv)\w*|\bendpoint is (?:now )?live\b|\bsubmission (?:is )?complete\b|\bwas submitted\b|\bhas been submitted\b/i;
for (const [file, text] of [[PACK, pack], [PLUGIN, packageText]]) {
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

if (errors.length > 0) {
	console.error(`ChatGPT package validation failed with ${errors.length} error(s):`);
	for (const e of errors) console.error(`- ${e}`);
	process.exit(1);
}
console.log(`ChatGPT package valid: ${ui.displayName}, ${positive.length} positive and ${negative.length} negative cases, endpoint ${ENDPOINT}.`);
const blockers = pack.match(/^\|.*\| BLOCKED: .*\|$/gm)?.length ?? 0;
console.log(`Not ready to submit: ${blockers} BLOCKED items in ${PACK}${review.demo_recording_url ? "" : ", demo_recording_url is empty"}.`);

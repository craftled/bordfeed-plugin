// Validates every manifest and the skill frontmatter. Exits 1 on any error.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse as parseYaml } from "yaml";

const errors = [];
const fail = (where, message) => errors.push(`${where}: ${message}`);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const MCP_URL = "https://bordfeed.com/api/mcp";
const NAME = "bordfeed";
const NAME_PATTERN = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

async function loadSchema(url) {
	const res = await fetch(url, { redirect: "follow" });
	if (!res.ok) throw new Error(`could not fetch schema ${url}: HTTP ${res.status}`);
	return res.json();
}

async function checkSchema(ajv, file, schemaUrl) {
	const schema = await loadSchema(schemaUrl);
	const validate = ajv.compile(schema);
	if (!validate(readJson(file))) {
		for (const e of validate.errors) fail(file, `${e.instancePath || "/"} ${e.message}`);
	}
}

// 1. Agent Plugins (root plugin.json and mcp.json), Claude Code (schemastore).
const ajv2020 = new Ajv2020({ allErrors: true, strict: false });
const ajv07 = new Ajv({ allErrors: true, strict: false });
addFormats(ajv2020);
addFormats(ajv07);
await checkSchema(ajv2020, "plugin.json", "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
await checkSchema(ajv2020, "mcp.json", "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
await checkSchema(ajv07, ".claude-plugin/plugin.json", "https://www.schemastore.org/claude-code-plugin-manifest.json");
await checkSchema(ajv07, ".claude-plugin/marketplace.json", "https://www.schemastore.org/claude-code-marketplace.json");

// 2. Cross-manifest consistency: one name, one version, one MCP URL, no credentials.
const manifests = {
	"plugin.json": readJson("plugin.json"),
	".claude-plugin/plugin.json": readJson(".claude-plugin/plugin.json"),
	".cursor-plugin/plugin.json": readJson(".cursor-plugin/plugin.json"),
};
const version = readJson("package.json").version;
for (const [file, m] of Object.entries(manifests)) {
	if (m.name !== NAME) fail(file, `name must be "${NAME}"`);
	if (m.version !== version) fail(file, `version ${m.version} does not match package.json ${version}`);
}
const servers = {
	"mcp.json": readJson("mcp.json").mcpServers,
	".claude-plugin/plugin.json": manifests[".claude-plugin/plugin.json"].mcpServers,
	".cursor-plugin/plugin.json": manifests[".cursor-plugin/plugin.json"].mcpServers,
};
for (const [file, s] of Object.entries(servers)) {
	if (s?.bordfeed?.url !== MCP_URL) fail(file, `mcpServers.bordfeed.url must be ${MCP_URL}`);
}
if (servers["mcp.json"].bordfeed.headers) {
	fail("mcp.json", "Agent Plugins headers are literal and must not carry credentials; auth is client-managed (OAuth)");
}
for (const file of [".claude-plugin/plugin.json", ".cursor-plugin/plugin.json"]) {
	const auth = servers[file].bordfeed.headers?.Authorization;
	if (auth !== "Bearer ${BORDFEED_API_KEY}") fail(file, "Authorization header must be the BORDFEED_API_KEY placeholder");
}
for (const file of [".claude-plugin/marketplace.json", ".cursor-plugin/marketplace.json"]) {
	const entry = readJson(file).plugins?.find((p) => p.name === NAME);
	if (!entry) fail(file, `no plugin entry named ${NAME}`);
	else if (entry.source !== "./") fail(file, 'plugin source must be "./"');
}

// 3. Cursor manifest (no published schema): name, relative paths, declared variables.
const cursor = manifests[".cursor-plugin/plugin.json"];
if (!NAME_PATTERN.test(cursor.name)) fail(".cursor-plugin/plugin.json", "name is not lowercase kebab-case");
for (const key of ["logo", "skills"]) {
	const value = cursor[key];
	if (typeof value !== "string") continue;
	if (value.startsWith("/") || value.includes("..")) fail(".cursor-plugin/plugin.json", `${key} must be a relative path inside the repo`);
	else if (!existsSync(value)) fail(".cursor-plugin/plugin.json", `${key} path ${value} does not exist`);
}
const declared = new Set(Object.keys(cursor.variables?.properties ?? {}));
for (const [, name] of JSON.stringify(cursor.mcpServers).matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
	if (!declared.has(name)) fail(".cursor-plugin/plugin.json", `\${${name}} is used but not declared in variables`);
}
if (cursor.variables?.type !== "object") fail(".cursor-plugin/plugin.json", 'variables.type must be "object"');

// 4. Skills: Agent Skills frontmatter rules.
const SKILL_NAME = /^(?!.*--)[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const skillDirs = readdirSync("skills").filter((d) => statSync(join("skills", d)).isDirectory());
if (skillDirs.length === 0) fail("skills", "no skills found");
for (const dir of skillDirs) {
	const file = join("skills", dir, "SKILL.md");
	if (!existsSync(file)) {
		fail(file, "missing");
		continue;
	}
	const match = readFileSync(file, "utf8").match(/^---\n([\s\S]*?)\n---\n/);
	if (!match) {
		fail(file, "missing YAML frontmatter");
		continue;
	}
	let fm;
	try {
		fm = parseYaml(match[1]);
	} catch (error) {
		fail(file, `frontmatter is not valid YAML: ${error.message}`);
		continue;
	}
	const allowed = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
	for (const key of Object.keys(fm)) if (!allowed.has(key)) fail(file, `unknown frontmatter field ${key}`);
	if (typeof fm.name !== "string" || !SKILL_NAME.test(fm.name)) fail(file, "name must be 1-64 lowercase letters, digits and single hyphens");
	if (fm.name !== dir) fail(file, `name "${fm.name}" must match its directory "${dir}"`);
	if (typeof fm.description !== "string" || fm.description.length < 1 || fm.description.length > 1024) fail(file, "description must be 1-1024 characters");
	if (fm.compatibility !== undefined && (typeof fm.compatibility !== "string" || fm.compatibility.length > 500)) fail(file, "compatibility must be a string of at most 500 characters");
	if (fm.metadata !== undefined) {
		for (const [k, v] of Object.entries(fm.metadata)) if (typeof v !== "string") fail(file, `metadata.${k} must be a string`);
	}
}

// 5. Repo-wide text rules: no em dashes, no committed API keys.
const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
	.split("\n")
	.filter((f) => f && existsSync(f) && !f.endsWith(".svg") && f !== "package-lock.json");
for (const file of tracked) {
	const text = readFileSync(file, "utf8");
	if (text.includes("\u2014")) fail(file, "contains an em dash");
	if (/bf_(live|test)_[A-Za-z0-9]{16,}/.test(text)) fail(file, "looks like it contains a Bordfeed API key");
}

if (errors.length > 0) {
	console.error(`Validation failed with ${errors.length} error(s):`);
	for (const e of errors) console.error(`- ${e}`);
	process.exit(1);
}
console.log(`Validation passed: 6 manifests, ${skillDirs.length} skill(s), ${tracked.length} files checked.`);

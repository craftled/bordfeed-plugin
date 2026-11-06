// Builds the ChatGPT directory ZIP at dist/bordfeed-chatgpt.zip after validating
// the package. Local only: this script uploads nothing.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
execFileSync(process.execPath, ["scripts/validate-chatgpt.mjs"], { stdio: "inherit" });

const OUTPUT = "dist/bordfeed-chatgpt.zip";
const manifest = readFileSync("submission/chatgpt/plugin.json");
const { logo, composerIcon } = JSON.parse(manifest).extensions["com.openai"].interface;
const zip = zipSync(
	{
		"plugin.json": manifest,
		"mcp.json": readFileSync("submission/chatgpt/mcp.json"),
		...Object.fromEntries([logo, composerIcon].map((path) => [path.slice(2), readFileSync(path)])),
	},
	{ mtime: "2000-01-01" },
);
mkdirSync("dist", { recursive: true });
writeFileSync(OUTPUT, zip);
console.log(`Wrote ${OUTPUT} (${zip.length} bytes). Nothing was uploaded.`);

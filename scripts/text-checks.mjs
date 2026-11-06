// Text rules both validators apply to every tracked file.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

export function trackedTextFiles() {
	return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
		.split("\n")
		.filter((f) => f && existsSync(f) && !f.endsWith(".svg") && !f.endsWith("package-lock.json"));
}

const BORDFEED_KEY_PLACEHOLDERS = new Set(["bf_live_your_key", "bf_live_invalid_smoke_test_key"]);
const SECRET_PATTERNS = {
	"a password-like assignment": /(?:password|passwd|pwd|passphrase|secret|api[_-]?key|access[_-]?token)["']?\s*[:=]\s*["']?(?!process\.env|bf_live_)[\w!@#%^&*+/=.~-]{6,}/i,
	"an sk- API key": /\bsk-[A-Za-z0-9_-]{20,}/,
	"a Stripe key": /\b[rs]k_(?:live|test)_[A-Za-z0-9]{10,}/,
	"a webhook signing secret": /\bwhsec_[A-Za-z0-9+/=]{8,}/,
	"a connection string with credentials": /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/]+@/i,
};

export function findSecrets(text) {
	const found = Object.entries(SECRET_PATTERNS)
		.filter(([, pattern]) => pattern.test(text))
		.map(([label]) => label);
	for (const [candidate] of text.matchAll(/bf_(?:live|test)_[A-Za-z0-9_-]{8,}/g)) {
		if (!BORDFEED_KEY_PLACEHOLDERS.has(candidate)) found.push("a Bordfeed API key");
	}
	return found;
}

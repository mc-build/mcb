import fs from "node:fs";
import path from "node:path";

let cachedVersion: string | null = null;

export function getVersion(): string | undefined {
	if (cachedVersion !== null) {
		return cachedVersion;
	}

	try {
		// Try to read from package.json in the project root
		// This works both in development and when bundled
		const packageJsonPath = path.resolve(__dirname, "..", "package.json");

		if (fs.existsSync(packageJsonPath)) {
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
			const version = packageJson.version || "unknown";
			cachedVersion = version;
			return version;
		}
	} catch (error) {
		// Fallback: try to read from a different location or return a default
	}

	return undefined;
}

export function getVersionString(): string {
	const version = getVersion();
	if (version === undefined) {
		return `(unknown)`;
	}
	return version;
}

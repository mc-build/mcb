import fs from "node:fs";
import path from "node:path";
import pkg from "../../package.json";
let cachedVersion: string | null = null;

export function getVersion(): string | undefined {
	if (cachedVersion !== null) {
		return cachedVersion;
	}

	return pkg.version;
}

export function getVersionString(): string {
	const version = getVersion();
	if (version === undefined) {
		return `(unknown)`;
	}
	return version;
}

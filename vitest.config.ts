import { readdirSync, statSync } from "fs";
import { join } from "path";
import { defineConfig } from "vitest/config";

function getAllTests(path: string) {
	const children = [];
	for (const file of readdirSync(path)) {
		const childPath = join(path, file);
		if (file.endsWith(".test.ts")) {
			children.push(childPath);
		} else if (statSync(childPath).isDirectory()) {
			children.push(...getAllTests(childPath));
		}
	}
	return children;
}

export default defineConfig({
	test: {
		watchTriggerPatterns: [
			{
				pattern: /vitests\/.+\.mcb$/,
				testsToRun(file, match) {
					return getAllTests("./vitests/");
				},
			},
		],
	},
});

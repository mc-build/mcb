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
		// Run test files serially. Under file parallelism the vite-node module
		// runner intermittently hands a worker a project module before its
		// exports are populated, so an unrelated test file's imports come back as
		// an empty namespace (e.g. `Parser`/`CompilerError` undefined). The suite
		// is small, so serial execution is a cheap, reliable workaround.
		fileParallelism: false,
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

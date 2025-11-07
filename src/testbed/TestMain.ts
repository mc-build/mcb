import fs from "node:fs";
import path from "node:path";

import { TestBuilder } from "./TestBuilder";
import { TestIo } from "./TestIo";
import { Compiler, VariableMap } from "../mcl/Compiler";
import { Parser } from "../mcl/Parser";
import { Tokenizer } from "../mcl/TokenizerImpl";
import { TemplateRegisterer } from "../mcl/TemplateRegisterer";
import { FeatureFlags } from "../mcl/FeatureFlags";
import { AstStringifier } from "../mcl/AstStringifier";

const WRITE_FLAG = process.argv.includes("--write");
const FILTER_ARG = (() => {
	const filterIndex = process.argv.findIndex((arg) => arg === "--filter");
	if (filterIndex >= 0) {
		return process.argv[filterIndex + 1] ?? "";
	}
	const prefixArg = process.argv.find((arg) => arg.startsWith("--filter="));
	if (prefixArg) {
		return prefixArg.split("=")[1] ?? "";
	}
	return "";
})();

TemplateRegisterer.register();
const versionMatrix = FeatureFlags.getAvailableVersions();
const tests = TestBuilder.getTests().filter((test) =>
	FILTER_ARG ? test.name.includes(FILTER_ARG) : true,
);

let hadFailure = false;

for (const test of tests) {
	console.log(`Running test: ${test.name}`);
	for (const version of versionMatrix) {
		const label = `(${version})`;
		try {
			const io = new TestIo();
			const compiler = new Compiler("", {
				internalScoreboardName: "_internal_scoreboard",
				formatVersion: version,
			});
			compiler.io = io;

			for (const source of test.sources) {
				const ext = path.extname(source.path);
				const tokens = Tokenizer.tokenize(source.content, source.path);
				const ast =
					ext === ".mcbt"
						? Parser.parseMcbtFile(tokens)
						: Parser.parseMcbFile(tokens);
				compiler.addFile(source.path, ast);
			}

			const jsRoot = (() => {
				if (!test.configPath) {
					return VariableMap.globals.fork();
				}
				const resolved = require.resolve(test.configPath);
				delete require.cache[resolved];
				// eslint-disable-next-line @typescript-eslint/no-var-requires
				const config = require(resolved) as Record<string, unknown>;
				const overrides = VariableMap.fromObject(config).get();
				return VariableMap.globals.fork(overrides);
			})();

			compiler.compile(jsRoot);
			const result = io.print();

			if (version === FeatureFlags.latestVersionSentinel) {
				try {
					const transformed = compiler.transform(jsRoot);
					const astSegments: string[] = [];
					for (const [fileName, ast] of transformed.entries()) {
						astSegments.push(
							`### ${fileName}\n${AstStringifier.stringify(ast)}`,
						);
					}
					ensureDirectory(test.resultPath);
					fs.writeFileSync(
						path.join(test.resultPath, `${version}.ast.mcb`),
						astSegments.join("\n"),
						"utf8",
					);
				} catch (error) {
					ensureDirectory(test.resultPath);
					fs.writeFileSync(
						path.join(test.resultPath, `${version}.ast.mcb`),
						String(error),
						"utf8",
					);
				}
			}

			const expected = test.expectedResult.get(version) ?? null;
			const normalizedActual = normalizeLineEndings(result);
			const normalizedExpected =
				expected !== null ? normalizeLineEndings(expected) : null;

			if (normalizedExpected === null || WRITE_FLAG) {
				ensureDirectory(test.resultPath);
				fs.writeFileSync(
					path.join(test.resultPath, `${version}.txt`),
					result,
					"utf8",
				);
				console.log(`${label} WROTE - ${test.name}`);
				continue;
			}

			if (normalizedExpected === normalizedActual) {
				console.log(`${label} PASS - ${test.name}`);
			} else {
				hadFailure = true;
				ensureDirectory(test.resultPath);
				const actualPath = path.join(test.resultPath, `${version}.actual.txt`);
				fs.writeFileSync(actualPath, result, "utf8");
				console.error(`${label} FAIL - ${test.name}`);
				console.error(
					`  Expected at ${path.join(test.resultPath, `${version}.txt`)}`,
				);
				console.error(`  Actual written to ${actualPath}`);
			}
		} catch (error) {
			hadFailure = true;
			ensureDirectory(test.resultPath);
			fs.writeFileSync(
				path.join(test.resultPath, `${version}.txt`),
				String(error),
				"utf8",
			);
			console.error(`${label} ERROR - ${test.name}`);
			console.error(error);
		}
	}
}

process.exitCode = hadFailure ? 1 : 0;

function normalizeLineEndings(content: string): string {
	return content.replace(/\r\n/g, "\n");
}

function ensureDirectory(dir: string) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

import path from "node:path";
import { describe, expect, it } from "vitest";
import { Compiler, VariableMap } from "../../src/mcl/Compiler";
import { Parser } from "../../src/mcl/Parser";
import { Tokenizer } from "../../src/mcl/TokenizerImpl";
import { TemplateRegisterer } from "../../src/mcl/TemplateRegisterer";
import { TestIo } from "../../src/testbed/TestIo";

TemplateRegisterer.register();

interface SourceFile {
	path: string;
	content: string;
}

function compile(sources: SourceFile[]): TestIo {
	const compiler = new Compiler("", {
		internalScoreboardName: "_internal_scoreboard",
		formatVersion: 48,
	});
	const io = new TestIo();
	compiler.io = io;

	for (const source of sources) {
		const ext = path.extname(source.path);
		const tokens = Tokenizer.tokenize(source.content, source.path);
		const ast =
			ext === ".mcbt"
				? Parser.parseMcbtFile(tokens)
				: Parser.parseMcbFile(tokens);
		compiler.addFile(source.path, ast);
	}

	compiler.compile(VariableMap.globals.fork());
	return io;
}

/**
 * Regression test: a "schedule <delay> <mode> { ... }" block used to consume
 * two uids (one before compiling its body, used for the "^0" self-reference
 * signature; one after, used for the actual saved file/schedule target).
 * A "^0" self-reference inside the block's own body would then resolve to
 * the wrong (unused) id instead of the id the block was actually saved
 * under, so the emitted "schedule function ^0 ..." pointed at a function
 * that didn't contain that body.
 */
describe("ScheduleBlock ^0 self-reference", () => {
	it("resolves ^0 inside the block body to the block's own generated function", () => {
		const io = compile([
			{
				path: "main.mcb",
				content: [
					"function tick {",
					"    schedule 1t replace {",
					"        execute unless function main:ready run return run schedule function ^0 1t replace",
					"        say ready",
					"    }",
					"}",
					"",
				].join("\n"),
			},
		]);

		const output = io.print();

		// Split into per-file blocks so we check the *generated* file's own
		// content, not the enclosing function's (unrelated) invocation of it.
		const files = new Map<string, string>();
		for (const block of output.split("----------------\n")) {
			const headerMatch = block.match(/^(data\/main\/function\/[^\n]+):\n/);
			if (headerMatch) {
				files.set(headerMatch[1], block.slice(headerMatch[0].length));
			}
		}

		const generatedFile = [...files.keys()].find((name) =>
			/^data\/main\/function\/zzz\/\d+\.mcfunction$/.test(name),
		);
		expect(generatedFile).toBeDefined();
		const ownPath = `main:${generatedFile!
			.replace("data/main/function/", "")
			.replace(".mcfunction", "")}`;

		// The self-reschedule *inside that same generated file* must target
		// its own path, not some other (wrong) uid.
		expect(files.get(generatedFile!)).toContain(
			`schedule function ${ownPath} 1t replace`,
		);
	});
});

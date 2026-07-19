import path from "node:path";
import { describe, expect, it } from "vitest";
import { Compiler, VariableMap } from "../../src/mcl/Compiler";
import { Parser } from "../../src/mcl/Parser";
import { Tokenizer } from "../../src/mcl/TokenizerImpl";
import { TemplateRegisterer } from "../../src/mcl/TemplateRegisterer";
import { CompilerError } from "../../src/mcl/error/CompilerError";
import { TestIo } from "../../src/testbed/TestIo";

TemplateRegisterer.register();

interface SourceFile {
	path: string;
	content: string;
}

function compileSources(sources: SourceFile[]): void {
	const compiler = new Compiler("", {
		internalScoreboardName: "_internal_scoreboard",
		formatVersion: 48,
	});
	compiler.io = new TestIo();

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
}

function compileAndCapture(sources: SourceFile[]): unknown {
	try {
		compileSources(sources);
	} catch (error) {
		return error;
	}
	throw new Error("expected compileSources to throw, but it did not");
}

/**
 * Regression test: emit.mcb() re-tokenizes generated code under a synthetic
 * "<inline <file>>" name shared by every emit.mcb() call within the same
 * file. SourceRegistry only registers a file's lines the first time it sees
 * that name, so a later emit.mcb() call in the same file that throws would
 * show the code frame from the FIRST emit.mcb() call's text instead of its
 * own, with the caret column computed against the wrong source line.
 */
describe("emit.mcb inline source registration", () => {
	it("shows the code frame for the failing emit.mcb() call, not an earlier one in the same file", () => {
		const error = compileAndCapture([
			{
				path: "main.mcb",
				content: [
					"import ./lib.mcbt",
					"function tick {",
					"    <%%",
					"        emit.mcb(`say this is the first unrelated snippet`)",
					"    %%>",
					"    <%%",
					"        emit.mcb(`sub onlytwoargs here`)",
					"    %%>",
					"}",
					"",
				].join("\n"),
			},
			{
				path: "lib.mcbt",
				content: [
					"template sub {",
					"    with a:word b:word c:word {",
					"        <%%",
					"            emit(`sub-ok ${a} ${b} ${c}`)",
					"        %%>",
					"    }",
					"}",
					"",
				].join("\n"),
			},
		]) as CompilerError;

		expect(error).toBeInstanceOf(CompilerError);
		expect(error.message).toContain(
			"Failed to find matching template overload for: sub onlytwoargs here",
		);
		// The code frame must come from the failing snippet...
		expect(error.message).toContain("sub onlytwoargs here");
		// ...not from the earlier, unrelated emit.mcb() call in the same file.
		expect(error.message).not.toContain("first unrelated snippet");
	});
});

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

describe("Compiler error stacktraces", () => {
	it("reports a single frame with a code frame for a plain compile error", () => {
		const error = compileAndCapture([
			{
				path: "main.mcb",
				content: [
					"function tick {",
					"    schedule {",
					"        say missing delay clause",
					"    }",
					"}",
					"",
				].join("\n"),
			},
		]) as CompilerError;

		expect(error).toBeInstanceOf(CompilerError);
		expect(error.message).toContain("--> main.mcb:2:5");
		expect(error.message).toContain("schedule {");
		expect(error.message).toContain("^");
		expect(error.message).not.toContain("Called from:");
		expect(error.mcbstack).toHaveLength(1);
	});

	it("threads a 'Called from' chain through nested template calls, innermost-first", () => {
		const error = compileAndCapture([
			{
				path: "main.mcb",
				content: ["import ./a.mcbt", "function tick {", "    a", "}", ""].join(
					"\n",
				),
			},
			{
				path: "a.mcbt",
				content: [
					"import ./b.mcbt",
					"template a {",
					"    with {",
					"        b",
					"    }",
					"}",
					"",
				].join("\n"),
			},
			{
				path: "b.mcbt",
				content: [
					"template b {",
					"    with {",
					"        schedule {",
					"            say inside b, this breaks",
					"        }",
					"    }",
					"}",
					"",
				].join("\n"),
			},
		]) as CompilerError;

		expect(error).toBeInstanceOf(CompilerError);

		// Primary frame: the throw site, deep inside template b's body.
		expect(error.message).toContain("--> b.mcbt:3:9");
		expect(error.message).toContain("schedule {");

		// Call chain: b was called from a.mcbt, which was called from main.mcb.
		expect(error.message).toContain("Called from:");
		const calledFromIdx = error.message.indexOf("Called from:");
		const aCallIdx = error.message.indexOf("at a.mcbt:4:9");
		const mainCallIdx = error.message.indexOf("at main.mcb:3:5");
		expect(aCallIdx).toBeGreaterThan(calledFromIdx);
		expect(mainCallIdx).toBeGreaterThan(aCallIdx);

		expect(error.mcbstack.map((p) => p.file)).toEqual([
			"b.mcbt",
			"a.mcbt",
			"main.mcb",
		]);
	});

	it("falls back to 'at <unknown>' for internal errors without a position", () => {
		const error = compileAndCapture([
			{
				path: "main.mcb",
				content: ["import ./other.mcb", "function tick {", "}", ""].join("\n"),
			},
			{
				path: "other.mcb",
				content: ["function foo {", "    say hi", "}", ""].join("\n"),
			},
		]) as CompilerError;

		expect(error).toBeInstanceOf(CompilerError);
		expect(error.internal).toBe(true);
		expect(error.message).toContain("Internal Compiler Error:");
		expect(error.message).toContain("at <unknown>");
	});
});

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
 * Regression test: `injectValues()` evaluates every `<%...%>` expression
 * embedded in a command string, but previously blamed every failure on the
 * position of the *whole command*, not the specific expression that threw.
 * When a command contains more than one `<%...%>` (or the failing one isn't
 * the first), the reported line/column pointed at the start of the command
 * instead of at the offending expression.
 */
describe("injectValues() error position", () => {
	it("points at the failing expression, not the start of the command, when multiple <%%> expressions share a line", () => {
		const error = compileAndCapture([
			{
				path: "main.mcb",
				content: [
					"function tick {",
					"    say <%1 + 1%> <%undefinedVar.foo%>",
					"}",
					"",
				].join("\n"),
			},
		]) as CompilerError;

		expect(error).toBeInstanceOf(CompilerError);
		expect(error.message).toContain("undefinedVar is not defined");
		// The command starts at column 5 (1-indexed, after the 4-space indent).
		// "say " (4) + "<%1 + 1%>" (9) + " " (1) = 14 more columns, so the
		// second expression starts at column 19 (1-indexed).
		expect(error.message).toContain("--> main.mcb:2:19");
		expect(error.message).not.toContain("--> main.mcb:2:5");
	});

	it("resolves a REPEAT 'as' variable inside a raw-argument template (e.g. a custom 'positioned' wrapper) and blames the real source position on failure", () => {
		// Mirrors the real-world pattern of a user-defined "positioned" template
		// (as seen in mc-build projects' execute.mcbt) that captures its whole
		// argument as raw text and re-emits it as a new command via emit.mcb().
		// <%...%> markers embedded in that raw text are now resolved eagerly,
		// against the calling context, while parsing the template argument -
		// so a REPEAT loop's `as` binding (here "cell") must still be visible,
		// and a failing expression must blame its real source position
		// directly, rather than a synthetic position inside the command that
		// emit.mcb() later re-synthesizes and re-tokenizes.
		const error = compileAndCapture([
			{
				path: "positioned.mcbt",
				content: [
					"template positioned {",
					"    with all:raw {",
					"        <%%",
					"            emit.mcb(`execute positioned ${all}`)",
					"        %%>",
					"    }",
					"}",
					"",
				].join("\n"),
			},
			{
				path: "main.mcb",
				content: [
					"import ./positioned.mcbt",
					"function tick {",
					"    REPEAT([{dy: 1}]) as cell {",
					"        positioned ~ ~<%cell.dy%> ~<%undefinedVar%> run say hi",
					"    }",
					"}",
					"",
				].join("\n"),
			},
		]) as CompilerError;

		expect(error).toBeInstanceOf(CompilerError);
		// "cell" resolved fine (it's not the reported error); only the
		// genuinely-undefined "undefinedVar" fails.
		expect(error.message).toContain("undefinedVar is not defined");
		expect(error.message).not.toContain("cell is not defined");
		// The failure is attributed to its real position in main.mcb - not a
		// synthetic "<inline ...>" position from emit.mcb()'s re-tokenized copy.
		expect(error.message).toContain("--> main.mcb:4:36");
		expect(error.message).not.toContain("<inline");
	});
});

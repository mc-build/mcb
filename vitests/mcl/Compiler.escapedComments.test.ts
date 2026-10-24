import path from "node:path";
import { describe, expect, it } from "vitest";
import { Compiler, VariableMap } from "../../src/mcl/Compiler";
import { Parser } from "../../src/mcl/Parser";
import { Tokenizer } from "../../src/mcl/TokenizerImpl";
import { ParserError } from "../../src/mcl/error/ParserError";
import { TemplateRegisterer } from "../../src/mcl/TemplateRegisterer";
import { TestIo } from "../../src/testbed/TestIo";

TemplateRegisterer.register();

interface SourceFile {
	path: string;
	content: string;
}

function compile(sources: SourceFile[]): string {
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
	return io.print();
}

/**
 * Comments are only evaluated when escaped as "\#". A bare "#" line is no
 * longer emitted as a comment, and escaped comments are only allowed inside a
 * function or template body.
 */
describe("escaped comments", () => {
	it("emits escaped comments inside a function, with the backslash stripped", () => {
		const output = compile([
			{
				path: "main.mcb",
				content: ["function foo {", "    \\# kept comment", "    say hi", "}", ""].join(
					"\n",
				),
			},
		]);
		expect(output).toContain("# kept comment");
		expect(output).not.toContain("\\# kept comment");
	});

	it("does not emit unescaped comments inside a function", () => {
		const output = compile([
			{
				path: "main.mcb",
				content: ["function foo {", "    # dropped comment", "    say hi", "}", ""].join(
					"\n",
				),
			},
		]);
		expect(output).not.toContain("dropped comment");
		expect(output).toContain("say hi");
	});

	it("emits escaped comments inside a nested block", () => {
		const output = compile([
			{
				path: "main.mcb",
				content: [
					"function foo {",
					"    block {",
					"        \\# kept in block",
					"    }",
					"}",
					"",
				].join("\n"),
			},
		]);
		expect(output).toContain("# kept in block");
	});

	it("throws a ParserError for an escaped comment at the top level", () => {
		const tokens = Tokenizer.tokenize("\\# top level", "main.mcb");
		expect(() => Parser.parseMcbFile(tokens)).toThrowError(ParserError);
	});

	it("throws a ParserError for an escaped comment inside a dir", () => {
		const tokens = Tokenizer.tokenize(
			["dir test {", "    \\# in a dir", "}", ""].join("\n"),
			"main.mcb",
		);
		expect(() => Parser.parseMcbFile(tokens)).toThrowError(ParserError);
	});

	it("allows an unescaped comment at the top level (dropped, not an error)", () => {
		const tokens = Tokenizer.tokenize("# top level", "main.mcb");
		expect(() => Parser.parseMcbFile(tokens)).not.toThrow();
	});

	it("preserves '#' tag references in tag blocks (they are not comments)", () => {
		const output = compile([
			{
				path: "main.mcb",
				content: [
					"function on_load minecraft:load {",
					"    say hi",
					"}",
					"tag functions test {",
					"    minecraft:load",
					"    #minecraft:load",
					"}",
					"",
				].join("\n"),
			},
		]);
		expect(output).toContain('"#minecraft:load"');
	});

	it("leaves multiline (###) comment blocks unchanged", () => {
		const output = compile([
			{
				path: "main.mcb",
				content: [
					"function foo {",
					"    ###",
					"    multi line",
					"    ###",
					"    say hi",
					"}",
					"",
				].join("\n"),
			},
		]);
		expect(output).toContain("### multi line");
	});
});

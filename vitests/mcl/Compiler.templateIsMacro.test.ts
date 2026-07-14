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

describe("isMacro inside template JS block contexts", () => {
	it("is false in a multi-line script block for a plain template call", () => {
		const io = compile([
			{
				path: "main.mcb",
				content: [
					"import ./greet.mcbt",
					"function tick {",
					"    greet world",
					"}",
					"",
				].join("\n"),
			},
			{
				path: "greet.mcbt",
				content: [
					"template greet {",
					"    with name:raw {",
					"        <%%",
					"            emit(`say hello ${name} macro=${isMacro}`)",
					"        %%>",
					"    }",
					"}",
					"",
				].join("\n"),
			},
		]);

		expect(io.print()).toContain("say hello world macro=false");
	});

	it("is true in a multi-line script block for a '$'-prefixed macro template call", () => {
		const io = compile([
			{
				path: "main.mcb",
				content: [
					"import ./greet.mcbt",
					"function tick {",
					"    $greet $(name)",
					"}",
					"",
				].join("\n"),
			},
			{
				path: "greet.mcbt",
				content: [
					"template greet {",
					"    with name:raw {",
					"        <%%",
					"            emit(`say hello ${name} macro=${isMacro}`)",
					"        %%>",
					"    }",
					"}",
					"",
				].join("\n"),
			},
		]);

		expect(io.print()).toContain("say hello $(name) macro=true");
	});

	it("is accessible inside a single-line '<% %>' inline expression in the template body", () => {
		const io = compile([
			{
				path: "main.mcb",
				content: [
					"import ./greet.mcbt",
					"function tick {",
					"    greet world",
					"    $greet $(name)",
					"}",
					"",
				].join("\n"),
			},
			{
				path: "greet.mcbt",
				content: [
					"template greet {",
					"    with name:raw {",
					"        say hello <%name%> macro=<%isMacro%>",
					"    }",
					"}",
					"",
				].join("\n"),
			},
		]);

		const output = io.print();
		expect(output).toContain("say hello world macro=false");
		expect(output).toContain("say hello $(name) macro=true");
	});

	it("reflects each call's own macro flag independently across multiple calls", () => {
		const io = compile([
			{
				path: "main.mcb",
				content: [
					"import ./greet.mcbt",
					"function tick {",
					"    greet a",
					"    $greet $(b)",
					"    greet c",
					"}",
					"",
				].join("\n"),
			},
			{
				path: "greet.mcbt",
				content: [
					"template greet {",
					"    with name:raw {",
					"        <%%",
					"            emit(`say ${name} macro=${isMacro}`)",
					"        %%>",
					"    }",
					"}",
					"",
				].join("\n"),
			},
		]);

		const output = io.print();
		expect(output).toContain("say a macro=false");
		expect(output).toContain("say $(b) macro=true");
		expect(output).toContain("say c macro=false");
	});
});

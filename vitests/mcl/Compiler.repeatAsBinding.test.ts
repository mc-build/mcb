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

describe("REPEAT ... as <name> binding in loop body scripts", () => {
	it("makes an underscore-containing loop variable available in a multi-line script", () => {
		const io = compile([
			{
				path: "main.mcb",
				content: [
					"function tick {",
					"    REPEAT([1, 2, 3]) as drop_point {",
					"        <%%",
					"            emit(`say value=${drop_point}`)",
					"        %%>",
					"    }",
					"}",
					"",
				].join("\n"),
			},
		]);

		const output = io.print();
		expect(output).toContain("say value=1");
		expect(output).toContain("say value=2");
		expect(output).toContain("say value=3");
	});

	it("makes an underscore-containing loop variable available in a '<% %>' inline expression", () => {
		const io = compile([
			{
				path: "main.mcb",
				content: [
					"function tick {",
					"    REPEAT([{n: 1}, {n: 2}]) as drop_point {",
					"        say value=<%drop_point.n%>",
					"    }",
					"}",
					"",
				].join("\n"),
			},
		]);

		const output = io.print();
		expect(output).toContain("say value=1");
		expect(output).toContain("say value=2");
	});
});

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

	// Regression test: user-defined block-type templates (e.g. an "if" template
	// implemented via a `block:block` argument and `embed(block)`, the common
	// pattern for sugaring `execute if ... run { ... }`) must not lose the
	// caller's local variable scope when the block argument is embedded back
	// into the output. Previously `McFile.embed()` unconditionally rebuilt the
	// compilation scope from `context.globalVariables`, discarding local scope
	// such as a REPEAT `as` binding, so `kick` (etc.) became "not defined" as
	// soon as it was referenced inside a `run { ... }` block passed through a
	// template like this.
	describe("loop variable visibility inside block-type template arguments", () => {
		const ifTemplate = {
			path: "if.mcbt",
			content: [
				"template if {",
				"    with all:raw block:block {",
				"        <%%",
				"            emit.mcb(`execute if ${all.trim()} run ${embed(block)}`)",
				"        %%>",
				"    }",
				"}",
				"",
			].join("\n"),
		};

		it("resolves a REPEAT 'as' variable referenced inside a template's embedded block", () => {
			const io = compile([
				ifTemplate,
				{
					path: "main.mcb",
					content: [
						"import ./if.mcbt",
						"function tick {",
						"    REPEAT([[0, 0], [1, 1]]) as kick {",
						"        if score #y v matches 0 run {",
						"            say <%kick[0]%> <%kick[1]%>",
						"        }",
						"    }",
						"}",
						"",
					].join("\n"),
				},
			]);

			const output = io.print();
			expect(output).toContain("say 0 0");
			expect(output).toContain("say 1 1");
		});

		it("resolves a REPEAT 'as' variable through two nested levels of the template", () => {
			const io = compile([
				ifTemplate,
				{
					path: "main.mcb",
					content: [
						"import ./if.mcbt",
						"function tick {",
						"    if score #x v matches 0 run {",
						"        REPEAT([[0, 0], [1, 1]]) as kick {",
						"            if score #y v matches 0 run {",
						"                say <%kick[0]%> <%kick[1]%>",
						"            }",
						"        }",
						"    }",
						"}",
						"",
					].join("\n"),
				},
			]);

			const output = io.print();
			expect(output).toContain("say 0 0");
			expect(output).toContain("say 1 1");
		});
	});
});

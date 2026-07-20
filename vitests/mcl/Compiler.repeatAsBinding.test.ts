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

	// Regression test: user-defined raw-argument-only templates (no `block`
	// argument at all, e.g. a custom "positioned" wrapper around
	// `execute positioned ... run <command>` as seen in mc-build projects'
	// execute.mcbt) must also see the caller's local variable scope. These
	// templates capture their whole argument as raw, unevaluated text and
	// reassemble it into a new command via emit.mcb(), which recompiles that
	// text in the template's own scope (deliberately isolated from caller
	// locals) - so a REPEAT `as` binding referenced inside the raw text used
	// to become "not defined" once emit.mcb() got to it.
	describe("loop variable visibility inside raw-argument (non-block) template arguments", () => {
		const positionedTemplate = {
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
		};

		it("resolves a REPEAT 'as' variable referenced inside a raw-argument template call", () => {
			const io = compile([
				positionedTemplate,
				{
					path: "main.mcb",
					content: [
						"import ./positioned.mcbt",
						"function tick {",
						"    REPEAT([{dx: 0, dy: 0}, {dx: 1, dy: 1}]) as cell {",
						"        positioned ~ ~<%cell.dy * 0.25%> ~<%cell.dx * 0.25%> run say hi",
						"    }",
						"}",
						"",
					].join("\n"),
				},
			]);

			const output = io.print();
			expect(output).toContain("execute positioned ~ ~0 ~0 run say hi");
			expect(output).toContain("execute positioned ~ ~0.25 ~0.25 run say hi");
		});
	});

	// Regression test: "word"-typed template arguments (e.g. the `name` in a
	// custom `set <name> <objective> <value>` template, the common pattern
	// for sugaring `scoreboard players set ...`) never evaluated <%...%>
	// expressions embedded in the captured word at all - unlike "raw"
	// arguments (fixed above), which only lost caller scope but did at least
	// resolve eventually. A word argument like `#row_<%row%>_complete` was
	// passed through completely unevaluated, so the compiled output
	// contained the literal, un-substituted "<%row%>" text.
	describe("loop variable visibility inside word-argument template arguments", () => {
		const setTemplate = {
			path: "set.mcbt",
			content: [
				"template set {",
				"    with name:word objective:word value:int {",
				"        scoreboard players set <%name%> <%objective%> <%value%>",
				"    }",
				"}",
				"",
			].join("\n"),
		};

		it("resolves a REPEAT 'as' variable embedded in a word-argument template call", () => {
			const io = compile([
				setTemplate,
				{
					path: "main.mcb",
					content: [
						"import ./set.mcbt",
						"function tick {",
						"    REPEAT(0, 2) as row {",
						"        set #is_row_<%row%>_complete v 0",
						"    }",
						"}",
						"",
					].join("\n"),
				},
			]);

			const output = io.print();
			expect(output).toContain("scoreboard players set #is_row_0_complete v 0");
			expect(output).toContain("scoreboard players set #is_row_1_complete v 0");
			expect(output).toContain("scoreboard players set #is_row_2_complete v 0");
			expect(output).not.toContain("<%row%>");
		});
	});
});

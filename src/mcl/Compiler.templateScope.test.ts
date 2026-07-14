import path from "node:path";
import { describe, expect, it } from "vitest";
import { Compiler, VariableMap } from "./Compiler";
import { Parser } from "./Parser";
import { Tokenizer } from "./TokenizerImpl";
import { TemplateRegisterer } from "./TemplateRegisterer";
import { TestIo } from "../testbed/TestIo";

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

describe("emit.mcb template resolution across scopes", () => {
	it("resolves templates that are only visible via the calling file's imports", () => {
		// wrapper.mcbt does NOT import lib.mcbt, so "greet" is only in scope
		// because main.mcb imports both. Calling "wrap" from main.mcb should
		// still let wrap's emit.mcb()-generated command resolve "greet".
		const io = compile([
			{
				path: "main.mcb",
				content: [
					"import ./lib.mcbt",
					"import ./wrapper.mcbt",
					"function tick {",
					"    wrap world",
					"}",
					"",
				].join("\n"),
			},
			{
				path: "lib.mcbt",
				content: [
					"template greet {",
					"    with name:raw {",
					"        <%%",
					"            emit(`say hello ${name}`)",
					"        %%>",
					"    }",
					"}",
					"",
				].join("\n"),
			},
			{
				path: "wrapper.mcbt",
				content: [
					"template wrap {",
					"    with name:raw {",
					"        <%%",
					"            emit.mcb(`greet ${name}`)",
					"        %%>",
					"    }",
					"}",
					"",
				].join("\n"),
			},
		]);

		const output = io.print();
		expect(output).toContain("say hello world");
		// If "greet" failed to resolve it would be emitted verbatim instead.
		expect(output).not.toContain("greet world");
	});

	it("still resolves templates defined in the template's own file when the caller lacks them", () => {
		// main.mcb only imports wrapper.mcbt (not lib.mcbt directly); wrapper.mcbt
		// imports lib.mcbt itself, so "greet" must still resolve via wrapper's
		// own template scope even though main.mcb never imported it.
		const io = compile([
			{
				path: "main.mcb",
				content: [
					"import ./wrapper.mcbt",
					"function tick {",
					"    wrap world",
					"}",
					"",
				].join("\n"),
			},
			{
				path: "lib.mcbt",
				content: [
					"template greet {",
					"    with name:raw {",
					"        <%%",
					"            emit(`say hello ${name}`)",
					"        %%>",
					"    }",
					"}",
					"",
				].join("\n"),
			},
			{
				path: "wrapper.mcbt",
				content: [
					"import ./lib.mcbt",
					"template wrap {",
					"    with name:raw {",
					"        <%%",
					"            emit.mcb(`greet ${name}`)",
					"        %%>",
					"    }",
					"}",
					"",
				].join("\n"),
			},
		]);

		expect(io.print()).toContain("say hello world");
	});

	it("prefers the template's own definition over the caller's when names collide", () => {
		// Both main.mcb (via lib.mcbt) and wrapper.mcbt itself define "greet".
		// wrapper's own body should call wrapper's own "greet", not the
		// caller's, since local scope takes precedence.
		const io = compile([
			{
				path: "main.mcb",
				content: [
					"import ./lib.mcbt",
					"import ./wrapper.mcbt",
					"function tick {",
					"    wrap world",
					"}",
					"",
				].join("\n"),
			},
			{
				path: "lib.mcbt",
				content: [
					"template greet {",
					"    with name:raw {",
					"        <%%",
					"            emit(`say caller hello ${name}`)",
					"        %%>",
					"    }",
					"}",
					"",
				].join("\n"),
			},
			{
				path: "wrapper.mcbt",
				content: [
					"template greet {",
					"    with name:raw {",
					"        <%%",
					"            emit(`say own hello ${name}`)",
					"        %%>",
					"    }",
					"}",
					"template wrap {",
					"    with name:raw {",
					"        <%%",
					"            emit.mcb(`greet ${name}`)",
					"        %%>",
					"    }",
					"}",
					"",
				].join("\n"),
			},
		]);

		const output = io.print();
		expect(output).toContain("say own hello world");
		expect(output).not.toContain("say caller hello world");
	});
});

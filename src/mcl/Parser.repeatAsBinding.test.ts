import { describe, expect, it } from "vitest";
import { Tokenizer } from "./TokenizerImpl";
import { Parser } from "./Parser";
import { AstNode } from "./AstNode";

function parseLoop(code: string): AstNode {
	const tokens = Tokenizer.tokenize(code, "repeat-as-binding.mcb");
	const [node] = Parser.parseInline(tokens);
	return node;
}

/**
 * Regression test for a bug where `REPEAT(...) as <name> { ... }` truncated
 * the bound variable name at the first underscore (e.g. "as drop_point"
 * bound only "drop"), because the parser's identifier regex used
 * `[a-zA-Z,\s]` instead of allowing word characters. This left references to
 * the real variable name undefined inside the loop body.
 */
describe("REPEAT ... as <name> variable name parsing", () => {
	it("captures the full variable name when it contains an underscore", () => {
		const node = parseLoop("REPEAT(items) as drop_point {\n    say hi\n}");
		expect(node.type).toBe("CompileTimeLoop");
		if (node.type !== "CompileTimeLoop") throw new Error("unreachable");
		expect(node.as).toEqual(["drop_point"]);
	});

	it("captures the full variable name when it contains digits", () => {
		const node = parseLoop("REPEAT(items) as item2 {\n    say hi\n}");
		if (node.type !== "CompileTimeLoop") throw new Error("unreachable");
		expect(node.as).toEqual(["item2"]);
	});

	it("still captures a simple single-letter variable name", () => {
		const node = parseLoop("REPEAT(3) as i {\n    say hi\n}");
		if (node.type !== "CompileTimeLoop") throw new Error("unreachable");
		expect(node.as).toEqual(["i"]);
	});

	it("still captures multiple destructured names", () => {
		const node = parseLoop("REPEAT(items) as first_name, last_name {\n    say hi\n}");
		if (node.type !== "CompileTimeLoop") throw new Error("unreachable");
		expect(node.as).toEqual(["first_name", "last_name"]);
	});
});

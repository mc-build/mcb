import { describe, expect, it } from "vitest";
import { Tokenizer } from "../../src/mcl/TokenizerImpl";
import { Parser } from "../../src/mcl/Parser";
import { ParserError } from "../../src/mcl/error/ParserError";

/**
 * Regression tests for crashes where the parser called `reader.peek().type`
 * without first checking `reader.hasNext()`. When the offending construct was
 * the very last token in the stream, `peek()` returned `undefined` and the
 * `.type` access threw a raw, undescriptive TypeError instead of a ParserError.
 */
describe("Parser end-of-stream guards", () => {
	it("reports a ParserError instead of crashing on a dangling 'dir' at end of file", () => {
		const tokens = Tokenizer.tokenize(
			"function tick {\n    say hi\n}\ndir foo",
			"crash-regressions/dangling-dir.mcb",
		);
		expect(() => Parser.parseMcbFile(tokens)).toThrowError(ParserError);
	});

	it("reports a ParserError instead of crashing on a dangling 'return run' with nothing after it", () => {
		// This is the exact shape produced by nested `execute ... run return run <command>`
		// expansions (e.g. from the `execute`/`if` template library) when the
		// generated snippet ends right after "return run" with no next token.
		const tokens = Tokenizer.tokenize(
			"return run",
			"crash-regressions/dangling-return-run.mcb",
		);
		expect(() => Parser.parseInline(tokens)).toThrowError(ParserError);
	});

	it("still parses a double 'run' chain ending in 'return run <command>' (the originally reported crash)", () => {
		// Reproduces the real-world failure: a generated `execute ... run return run function ./foo`
		// command, which previously crashed with 'Cannot read properties of
		// undefined (reading 'type')' inside the "return run" handling.
		const tokens = Tokenizer.tokenize(
			"execute if entity @s run return run function ./remove_player_from_queue",
			"crash-regressions/double-run.mcb",
		);
		expect(() => Parser.parseInline(tokens)).not.toThrow();
	});

	it("still parses 'return run' followed by a block", () => {
		const tokens = Tokenizer.tokenize(
			"function tick {\n    return run {\n        say hi\n    }\n}",
			"crash-regressions/return-run-block.mcb",
		);
		expect(() => Parser.parseMcbFile(tokens)).not.toThrow();
	});

	it("still parses a bare 'return run <command>' followed by more statements", () => {
		const tokens = Tokenizer.tokenize(
			"function tick {\n    return run say hi\n    say after\n}",
			"crash-regressions/return-run-followed-by-more.mcb",
		);
		expect(() => Parser.parseMcbFile(tokens)).not.toThrow();
	});
});

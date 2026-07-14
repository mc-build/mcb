import { describe, expect, it } from "vitest";
import { PosInfo } from "../../../src/mcl/Tokenizer";
import { SourceRegistry } from "../../../src/mcl/SourceRegistry";
import { ParserError } from "../../../src/mcl/error/ParserError";
import { McbError } from "../../../src/mcl/error/McbError";

function pos(file: string, line: number, col: number): PosInfo {
	return { file, line, col };
}

describe("ParserError", () => {
	it("has the name 'ParserError'", () => {
		const error = new ParserError("bad token");
		expect(error.name).toBe("ParserError");
	});

	it("is recognized by McbError.isMclError", () => {
		expect(McbError.isMclError(new ParserError("bad token"))).toBe(true);
	});

	it("falls back to 'at <unknown>' when no position is given", () => {
		const error = new ParserError("Unexpected end of file!");
		expect(error.message).toBe(
			"Parser Error:\n\tUnexpected end of file!\n\tat <unknown>",
		);
		expect(error.mcbstack).toEqual([]);
	});

	it("shows the location when a position is given", () => {
		const error = new ParserError(
			"Unexpected token 'foo'",
			pos("parser-error-test/plain.mcb", 3, 1),
		);
		expect(error.message).toContain("--> parser-error-test/plain.mcb:3:2");
		expect(error.mcbstack).toEqual([pos("parser-error-test/plain.mcb", 3, 1)]);
	});

	it("includes a code frame when source is registered for the file", () => {
		SourceRegistry.register(
			"parser-error-test/with-source.mcb",
			"function tick {\n    invalid syntax here\n}",
		);
		const error = new ParserError(
			"Unexpected token",
			pos("parser-error-test/with-source.mcb", 2, 4),
		);
		expect(error.message).toContain("invalid syntax here");
		expect(error.message).toContain("^");
	});
});

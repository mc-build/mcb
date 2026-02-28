import { describe, expect, it } from "vitest";
import { Tokenizer } from "../../src/mcl/Tokenizer";
import { expectToMatchFile, tokenize } from "../TestFramework";
import { join } from "path";

export const matchTokenFile = async (file: string) => {
	const result = await tokenize(join("mcb", file));
	const path = join(__dirname, `${file}.tokens.json`);
	await expectToMatchFile(JSON.stringify(result.tokens, null, 2), path);
};

const MCB_FILES = ["all.mcb", "multiline-brackets.mcb"];

describe("Tokenizer", async () => {
	it.each(MCB_FILES)(`tokenizes %s`, matchTokenFile, 10_000);

	describe(`throws SyntaxPointerError on unterminated scripts`, () => {
		it(`inline script`, () => {
			expect(() => {
				new Tokenizer(`<%`, "fail.mcb").tokenize();
			}).toThrowError(
				/Expected "%>" to end Inline Script, but found "<EOF>" instead at 1:3/,
			);
		});

		it(`script block`, () => {
			expect(() => {
				new Tokenizer(`<%%`, "fail.mcb").tokenize();
			}).toThrowError(
				/Expected "%%>" to end Script Block, but found "<EOF>" instead at 1:4/,
			);
		});
	});
});

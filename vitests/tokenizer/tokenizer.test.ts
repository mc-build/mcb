import { join, parse } from "path";
import { describe, expect, it } from "vitest";
import { Tokenizer } from "../../src/mcl/TokenizerImpl";
import { expectToMatchFile, read } from "../TestFramework";

async function tokenize(srcFile: string) {
	const parsed = parse(srcFile);
	const source = await read(srcFile);
	return new Tokenizer(source, parsed.base).tokenize();
}

const matchTokenFile = async (file: string) => {
	const tokens = await tokenize(join("mcb", file));
	const path = join(__dirname, `${file}.tokens.json`);
	await expectToMatchFile(JSON.stringify(tokens, null, 2), path);
};

const MCB_FILES = ["all.mcb", "multiline-brackets.mcb"];

describe("Tokenizer", async () => {
	it.each(MCB_FILES)(`tokenizes %s`, matchTokenFile, 10_000);
});

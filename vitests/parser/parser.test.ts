import { describe, it } from "vitest";
import { NewParser } from "../../src/mcl/Parser";
import { tokenize } from "../TestFramework";
import { writeFile } from "fs/promises";
// @ts-expect-error
import prettier from "@prettier/sync";

describe("Parser", () => {
	it("should parse all.mcb", async () => {
		const result = await tokenize("mcb/all.mcb");
		const ast = new NewParser(result).parseMcbFile();
		await writeFile(
			"mcb-parser-output.json",
			prettier.format(JSON.stringify(ast), { parser: "json" }),
		);
	});
});

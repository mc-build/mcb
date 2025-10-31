import { readFileSync } from "fs";
import { parse } from "path";
import { bench } from "vitest";
import { Tokenizer } from "../../src/mcl/Tokenizer";

const path = "./vitests/mcb/impossible_to_survive.mcb";
const file = readFileSync(path, "utf-8");
const parsed = parse(path);

bench(
	"Tokenizer#tokenize",
	() => {
		new Tokenizer(file, parsed.base).tokenize();
	},
	{ iterations: 500 },
);

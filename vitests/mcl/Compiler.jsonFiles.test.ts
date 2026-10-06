import { describe, expect, it } from "vitest";
import { Compiler, VariableMap } from "../../src/mcl/Compiler";
import { Parser } from "../../src/mcl/Parser";
import { Tokenizer } from "../../src/mcl/TokenizerImpl";
import { TemplateRegisterer } from "../../src/mcl/TemplateRegisterer";
import { McbError } from "../../src/mcl/error/McbError";

TemplateRegisterer.register();

let projectCounter = 0;

/** Compiles `lines` as `main.mcb` in a fresh project, so SourceRegistry never sees a stale file. */
function compile(lines: string[], newline = "\n") {
	const baseDir = `json-files-test-${projectCounter++}`;
	const compiler = new Compiler(baseDir, {
		internalScoreboardName: "_internal_scoreboard",
		formatVersion: 48,
	});
	const files = new Map<string, string>();
	compiler.io = {
		write: (path, content) => files.set(path.replace(/\\/g, "/"), content),
		cleanup() {},
		finished: () => true,
	};
	const warnings: string[] = [];
	compiler.onWarning = (message) => warnings.push(message);
	const file = `${baseDir}/main.mcb`;
	const tokens = Tokenizer.tokenize(lines.join(newline), file);
	compiler.addFile(file, Parser.parseMcbFile(tokens));
	compiler.compile(VariableMap.globals.fork());
	return { files, warnings, file };
}

function compileError(lines: string[]): McbError {
	try {
		compile(lines);
	} catch (error) {
		if (error instanceof McbError) return error;
		throw error;
	}
	throw new Error("expected compile to throw");
}

describe("json files", () => {
	it("expands IF/ELSE IF/ELSE and REPEAT nested inside arrays", () => {
		const { files } = compile([
			"loot_table pools {",
			"    pools: [",
			"        REPEAT([1, 2, 3]) as n {",
			"            {",
			"                rolls: <%n%>",
			"                entries: [",
			"                    IF (n === 1) {",
			"                        { name: 'minecraft:stone' }",
			"                    }",
			"                    ELSE IF (n === 2) {",
			"                        { name: 'minecraft:dirt' }",
			"                    } ELSE {",
			"                        { name: 'minecraft:air' }",
			"                    }",
			"                ]",
			"            }",
			"        }",
			"    ]",
			"}",
		]);
		expect(files.get("data/main/loot_table/pools.json")).toBe(
			'{"pools":[' +
				'{"rolls":1,"entries":[{"name":"minecraft:stone"}]},' +
				'{"rolls":2,"entries":[{"name":"minecraft:dirt"}]},' +
				'{"rolls":3,"entries":[{"name":"minecraft:air"}]}]}',
		);
	});

	it("keeps braces inside strings and handles mid-line brackets", () => {
		const { files } = compile([
			"json data text {",
			'    a: "x {"',
			'    b: "y{ z"',
			'    c: {"d": 1',
			"    }, e: [",
			"        1, {f: 2}",
			"    ]",
			"}",
		]);
		expect(files.get("data/main/data/text.json")).toBe(
			'{"a":"x {","b":"y{ z","c":{"d":1},"e":[1,{"f":2}]}',
		);
	});

	it("skips #, // and multi-line /* */ comments", () => {
		const { files } = compile([
			"json data comments {",
			"    # an { MCB comment",
			"    a: 1 // a { line comment",
			"    /* a block {",
			"       comment */",
			"    b: 2",
			"}",
		]);
		expect(files.get("data/main/data/comments.json")).toBe('{"a":1,"b":2}');
	});

	it("handles CRLF line endings", () => {
		const { files } = compile(
			["json data crlf {", "    IF (true) {", "        a: 1", "    }", "}"],
			"\r\n",
		);
		expect(files.get("data/main/data/crlf.json")).toBe('{"a":1}');
	});

	it("injects <% %> into the subfolder and name, even with spaces", () => {
		const { files } = compile([
			"REPEAT([1]) as i {",
			"    json <% 'sub' + i %> file_<% i + 1 %> [<%i%>]",
			"}",
		]);
		expect(files.get("data/main/sub1/file_2.json")).toBe("[1]");
	});

	it("warns about duplicate keys at the source line that repeats them", () => {
		const { files, warnings, file } = compile([
			"json data dupes {",
			"    on: 1",
			"    IF (true) {",
			"        on: 2",
			"    }",
			"}",
		]);
		expect(files.get("data/main/data/dupes.json")).toBe('{"on":2}');
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain(
			"JSON warning in 'data/main/data/dupes.json': Duplicate key 'on', the last value wins",
		);
		expect(warnings[0]).toContain(`${file}:4:9`);
	});

	it("maps JSON errors to the source line and shows the generated JSON", () => {
		const error = compileError([
			"json data broken {",
			"    REPEAT([1, 2]) as n {",
			"        k<%n%>: minecraft:stone",
			"    }",
			"}",
		]);
		expect(error.message).toContain(
			"Invalid JSON in 'data/main/data/broken.json': Unquoted strings can't contain ':'",
		);
		expect(error.message).toContain("2 | k1: minecraft:stone");
		// The error is inside injected text, so it points at the <% %> expression.
		expect(error.mcbstack[0]).toMatchObject({ line: 3, col: 9 });
	});

	it("points at the exact column on lines without <% %>", () => {
		const error = compileError(["json data broken {", '    "x" 1', "}"]);
		expect(error.message).toContain("Expected ':' after key 'x', found '1'");
		expect(error.mcbstack[0]).toMatchObject({ line: 2, col: 8 });
	});

	it.each([
		[["json data a"], "Expected 'json <subfolder> <name> <value>'"],
		[["json data a {", "    a: 1"], "Unexpected end of file in JSON value"],
		[
			[
				"json data a {",
				"    IF (true) {",
				"        a: 1",
				"    ]",
				"    }",
				"}",
			],
			"This closes a bracket opened outside the IF/ELSE/REPEAT block",
		],
		[
			["json data a {", "    REPEAT([1]) {", "    } ELSE {", "    }", "}"],
			"Unexpected 'ELSE {' after '}'",
		],
	])("rejects malformed bodies: %j", (lines, message) => {
		expect(compileError(lines).message).toContain(message);
	});

	it("rejects non-object content in a {} root", () => {
		expect(
			compileError(["json data a {", "    [1, 2]", "}"]).message,
		).toContain("Expected a key, found '['");
	});
});

import { describe, expect, it } from "vitest";
import { JsonParser, JsonSyntaxError } from "../../src/mcl/JsonParser";

function convert(text: string): string {
	return JsonParser.stringify(JsonParser.parse(text).value);
}

function parseError(text: string): JsonSyntaxError {
	try {
		JsonParser.parse(text);
	} catch (error) {
		if (error instanceof JsonSyntaxError) return error;
		throw error;
	}
	throw new Error(`expected '${text}' to fail to parse`);
}

describe("JsonParser", () => {
	it("parses strict JSON unchanged", () => {
		const json = '{"a":[1,-2.5e3,true,false,null],"b":{"c":"d\\n\\""}}';
		expect(convert(json)).toBe(json);
		expect(convert('"\\u00e9"')).toBe('"é"');
	});

	it("makes commas optional and allows trailing commas", () => {
		expect(convert("{ a: 1 b: 2, c: [1 2 3,], }")).toBe(
			'{"a":1,"b":2,"c":[1,2,3]}',
		);
		expect(convert('["a""b"]')).toBe('["a","b"]');
	});

	it("rejects leading and doubled commas", () => {
		expect(parseError("[1,,2]").message).toBe("Unexpected ','");
		expect(parseError("{,a:1}").message).toBe("Unexpected ','");
	});

	it("accepts unquoted keys and simple unquoted string values", () => {
		expect(convert("{ type: item, weight-1.x: a_b+c }")).toBe(
			'{"type":"item","weight-1.x":"a_b+c"}',
		);
	});

	it("treats true, false and null as keywords in values but not keys", () => {
		expect(convert("{ true: false, null: null }")).toBe(
			'{"true":false,"null":null}',
		);
	});

	it("requires quotes for values containing ':' or starting with '#'", () => {
		const colon = parseError("{ item: minecraft:stone }");
		expect(colon.message).toBe(
			"Unquoted strings can't contain ':', wrap the value in quotes",
		);
		expect(colon.offset).toBe(8);
		expect(parseError("{ tag: #minecraft:logs }").message).toBe(
			"Tag references must be quoted, like '#minecraft:logs'",
		);
		expect(convert("{ item: 'minecraft:stone', tag: '#minecraft:beds' }")).toBe(
			'{"item":"minecraft:stone","tag":"#minecraft:beds"}',
		);
	});

	it("supports single-quoted strings and escapes", () => {
		expect(convert(`['it\\'s', "say \\"hi\\"", '\\t/\\/']`)).toBe(
			'["it\'s","say \\"hi\\"","\\t//"]',
		);
		expect(parseError('"\\q"').message).toBe("Invalid escape sequence '\\q'");
	});

	it("keeps number text verbatim", () => {
		expect(convert("[1.0, 1e400, 12345678901234567890]")).toBe(
			"[1.0,1e400,12345678901234567890]",
		);
	});

	it.each(["01", "1.", ".5", "+1", "1abc", "-"])(
		"rejects the non-JSON number '%s'",
		(number) => {
			expect(() => JsonParser.parse(`[${number}]`)).toThrow(JsonSyntaxError);
		},
	);

	it("skips // and /* */ comments", () => {
		expect(convert("{ // one\n a: 1 /* two { */ b: 2 }")).toBe('{"a":1,"b":2}');
		expect(parseError("{ /* open").message).toBe("Unterminated block comment");
	});

	it("warns about duplicate keys and keeps the last value", () => {
		const { value, warnings } = JsonParser.parse("{ a: 1, b: 2, a: 3 }");
		expect(JsonParser.stringify(value)).toBe('{"a":3,"b":2}');
		expect(warnings).toEqual([
			{ message: "Duplicate key 'a', the last value wins", offset: 14 },
		]);
	});

	it("preserves key order, including integer-like keys", () => {
		expect(convert('{ b: 1, "1": 2, __proto__: 3 }')).toBe(
			'{"b":1,"1":2,"__proto__":3}',
		);
	});

	it("reports where unclosed values were opened", () => {
		expect(parseError("{ a: [1, 2 }").message).toBe(
			"Unexpected '}', expected ']' to close the array",
		);
		expect(parseError("[{ a: 1 ]").message).toBe(
			"Unexpected ']', expected '}' to close the object",
		);
		const object = parseError("\n  { a: 1");
		expect(object.message).toBe("Expected '}' to close the object opened here");
		expect(object.offset).toBe(3);
		expect(parseError('{ a: "b\n" }').message).toBe(
			'Expected " to close the string opened here',
		);
	});

	it("rejects missing values and text after the root", () => {
		expect(parseError("  ").message).toBe("Expected a JSON value");
		expect(parseError("{ a: }").message).toBe("Expected a value, found '}'");
		expect(parseError("{} []").message).toBe(
			"Unexpected '[' after the root value",
		);
	});
});

export type JsonValue =
	| { kind: "object"; entries: Map<string, JsonValue> }
	| { kind: "array"; items: JsonValue[] }
	| { kind: "string"; value: string }
	| { kind: "number"; raw: string }
	| { kind: "boolean"; value: boolean }
	| { kind: "null" };

export interface JsonWarning {
	message: string;
	offset: number;
}

/** A syntax error at {@link offset} characters into the parsed text. */
export class JsonSyntaxError extends Error {
	constructor(
		message: string,
		readonly offset: number,
	) {
		super(message);
		this.name = "JsonSyntaxError";
	}
}

const NUMBER_REGEX = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
const LITERAL_START_REGEX = /[A-Za-z_]/;
const LITERAL_REGEX = /[A-Za-z_][A-Za-z0-9_.+-]*/y;
const WHITESPACE_REGEX = /\s/;
const BOUNDARY_CHARS = new Set([",", ":", "[", "]", "{", "}", '"', "'"]);
const ESCAPES: Record<string, string> = {
	'"': '"',
	"'": "'",
	"\\": "\\",
	"/": "/",
	b: "\b",
	f: "\f",
	n: "\n",
	r: "\r",
	t: "\t",
};

/**
 * Parses MCB's relaxed JSON: commas are optional, keys and simple string values
 * may be unquoted, strings may use single quotes, and `//` and `/* *\/` comments are allowed.
 */
export class JsonParser {
	private index = 0;
	private readonly warnings: JsonWarning[] = [];

	private constructor(private readonly text: string) {}

	static parse(text: string): { value: JsonValue; warnings: JsonWarning[] } {
		const parser = new JsonParser(text);
		parser.skipWhitespace();
		if (parser.peek() === undefined) {
			parser.fail("Expected a JSON value");
		}
		const value = parser.parseValue();
		parser.skipWhitespace();
		if (parser.peek() !== undefined) {
			parser.fail(`Unexpected '${parser.peek()}' after the root value`);
		}
		return { value, warnings: parser.warnings };
	}

	static stringify(value: JsonValue): string {
		switch (value.kind) {
			case "object":
				return `{${Array.from(
					value.entries,
					([key, entry]) =>
						`${JSON.stringify(key)}:${JsonParser.stringify(entry)}`,
				).join(",")}}`;
			case "array":
				return `[${value.items.map((item) => JsonParser.stringify(item)).join(",")}]`;
			case "string":
				return JSON.stringify(value.value);
			case "number":
				return value.raw;
			case "boolean":
				return String(value.value);
			case "null":
				return "null";
		}
	}

	private peek(offset = 0): string | undefined {
		return this.text[this.index + offset];
	}

	private fail(message: string, offset = this.index): never {
		throw new JsonSyntaxError(message, offset);
	}

	private describeCurrent(): string {
		const char = this.peek();
		return char === undefined ? "end of JSON" : `'${char}'`;
	}

	private skipWhitespace(): void {
		while (this.index < this.text.length) {
			const char = this.text[this.index];
			if (WHITESPACE_REGEX.test(char)) {
				this.index++;
			} else if (char === "/" && this.peek(1) === "/") {
				const end = this.text.indexOf("\n", this.index);
				this.index = end === -1 ? this.text.length : end;
			} else if (char === "/" && this.peek(1) === "*") {
				const end = this.text.indexOf("*/", this.index + 2);
				if (end === -1) {
					this.fail("Unterminated block comment");
				}
				this.index = end + 2;
			} else {
				return;
			}
		}
	}

	private isAtBoundary(): boolean {
		const char = this.peek();
		return (
			char === undefined ||
			WHITESPACE_REGEX.test(char) ||
			BOUNDARY_CHARS.has(char) ||
			(char === "/" && (this.peek(1) === "/" || this.peek(1) === "*"))
		);
	}

	private parseValue(): JsonValue {
		const char = this.peek();
		if (char === "{") {
			return this.parseObject();
		}
		if (char === "[") {
			return this.parseArray();
		}
		if (char === '"' || char === "'") {
			return { kind: "string", value: this.parseString() };
		}
		if (char === "-" || (char !== undefined && char >= "0" && char <= "9")) {
			return this.parseNumber();
		}
		if (char !== undefined && LITERAL_START_REGEX.test(char)) {
			return this.parseLiteralValue();
		}
		if (char === "#") {
			this.fail("Tag references must be quoted, like '#minecraft:logs'");
		}
		this.fail(`Expected a value, found ${this.describeCurrent()}`);
	}

	private parseObject(): JsonValue {
		const start = this.index;
		this.index++;
		const entries = new Map<string, JsonValue>();
		while (true) {
			this.skipWhitespace();
			const char = this.peek();
			if (char === "}") {
				this.index++;
				return { kind: "object", entries };
			}
			if (char === undefined) {
				this.fail("Expected '}' to close the object opened here", start);
			}
			if (char === "]") {
				this.fail("Unexpected ']', expected '}' to close the object");
			}
			if (char === ",") {
				this.fail("Unexpected ','");
			}
			const keyOffset = this.index;
			const key = this.parseKey();
			this.skipWhitespace();
			if (this.peek() !== ":") {
				this.fail(
					`Expected ':' after key '${key}', found ${this.describeCurrent()}`,
				);
			}
			this.index++;
			this.skipWhitespace();
			const value = this.parseValue();
			if (entries.has(key)) {
				this.warnings.push({
					message: `Duplicate key '${key}', the last value wins`,
					offset: keyOffset,
				});
			}
			entries.set(key, value);
			this.consumeSeparator("}");
		}
	}

	private parseArray(): JsonValue {
		const start = this.index;
		this.index++;
		const items: JsonValue[] = [];
		while (true) {
			this.skipWhitespace();
			const char = this.peek();
			if (char === "]") {
				this.index++;
				return { kind: "array", items };
			}
			if (char === undefined) {
				this.fail("Expected ']' to close the array opened here", start);
			}
			if (char === "}") {
				this.fail("Unexpected '}', expected ']' to close the array");
			}
			if (char === ",") {
				this.fail("Unexpected ','");
			}
			items.push(this.parseValue());
			this.consumeSeparator("]");
		}
	}

	/** Consumes an optional comma after an entry, rejecting a second one. */
	private consumeSeparator(close: string): void {
		if (!this.isAtBoundary()) {
			this.fail(
				`Unexpected ${this.describeCurrent()}, expected ',' or '${close}'`,
			);
		}
		this.skipWhitespace();
		if (this.peek() === ",") {
			this.index++;
			this.skipWhitespace();
			if (this.peek() === ",") {
				this.fail("Unexpected ','");
			}
		}
	}

	private parseKey(): string {
		const char = this.peek();
		if (char === '"' || char === "'") {
			return this.parseString();
		}
		if (char !== undefined && LITERAL_START_REGEX.test(char)) {
			return this.parseLiteral();
		}
		this.fail(
			`Expected a key, found ${this.describeCurrent()}. Keys that don't match [A-Za-z_][A-Za-z0-9_.+-]* must be quoted`,
		);
	}

	private parseLiteral(): string {
		LITERAL_REGEX.lastIndex = this.index;
		const match = LITERAL_REGEX.exec(this.text)!;
		this.index += match[0].length;
		return match[0];
	}

	private parseLiteralValue(): JsonValue {
		const start = this.index;
		const literal = this.parseLiteral();
		const next = this.peek();
		if (
			next === ":" ||
			next === "#" ||
			(next === "/" && !this.isAtBoundary())
		) {
			this.fail(
				`Unquoted strings can't contain '${next}', wrap the value in quotes`,
				start,
			);
		}
		switch (literal) {
			case "true":
				return { kind: "boolean", value: true };
			case "false":
				return { kind: "boolean", value: false };
			case "null":
				return { kind: "null" };
			default:
				return { kind: "string", value: literal };
		}
	}

	private parseNumber(): JsonValue {
		NUMBER_REGEX.lastIndex = this.index;
		const match = NUMBER_REGEX.exec(this.text);
		if (!match) {
			this.fail("Invalid number");
		}
		this.index += match[0].length;
		if (!this.isAtBoundary()) {
			this.fail(`Unexpected ${this.describeCurrent()} after number`);
		}
		return { kind: "number", raw: match[0] };
	}

	private parseString(): string {
		const quote = this.text[this.index];
		const start = this.index;
		this.index++;
		let result = "";
		while (true) {
			const char = this.peek();
			if (char === undefined || char === "\n" || char === "\r") {
				this.fail(`Expected ${quote} to close the string opened here`, start);
			}
			this.index++;
			if (char === quote) {
				return result;
			}
			if (char !== "\\") {
				result += char;
				continue;
			}
			const escape = this.peek();
			if (escape === "u") {
				const hex = this.text.substring(this.index + 1, this.index + 5);
				if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
					this.fail(
						"Invalid unicode escape, expected \\u followed by 4 hex digits",
						this.index - 1,
					);
				}
				result += String.fromCharCode(parseInt(hex, 16));
				this.index += 5;
			} else if (escape !== undefined && escape in ESCAPES) {
				result += ESCAPES[escape];
				this.index++;
			} else {
				this.fail(
					`Invalid escape sequence '\\${escape ?? ""}'`,
					this.index - 1,
				);
			}
		}
	}
}

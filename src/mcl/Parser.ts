import { Token, TokenIds, PosInfo } from "./Tokenizer";
import { ArrayInput } from "./ArrayInput";
import { ParserError } from "./error/ParserError";
import { StringUtils } from "../strutils/StringUtils";
import { AstNode, JsonTagType } from "./AstNode";

type TokenInput = ArrayInput<Token>;
type CompileTimeElse = { condition: string | null; node: AstNode[] };

const loopRegExp = /(REPEAT\s*\(.+?\))\s\s*as\s\s*([\w$,\s]+)/;
const executeRegExp = /\b(run\s+?)\b/;

function format(
	template: string,
	...data: Array<string | number | null | undefined>
): string {
	let result = template;
	for (const field of data) {
		result = result.replace("{}", String(field));
	}
	return result;
}

const ESCAPED_COMMENT_SCOPE_ERROR =
	"Escaped comments (\\#) are only valid inside a function or template body";

function isEscapedComment(value: string): boolean {
	return StringUtils.startsWithConstExpr(value, "\\#");
}

// Returns the index of the first `ch` in `value` that is not inside an
// inline `<% %>` script, or -1.
function indexOfOutsideScripts(value: string, ch: string, from = 0): number {
	let depth = 0;
	for (let i = from; i < value.length; i++) {
		if (value.startsWith("<%", i)) {
			depth++;
			i++;
		} else if (depth > 0 && value.startsWith("%>", i)) {
			depth--;
			i++;
		} else if (depth === 0 && value.charAt(i) === ch) {
			return i;
		}
	}
	return -1;
}

// The tokenizer keeps a line with balanced braces as one literal, so
// `tag blocks foo { minecraft:stone }` arrives here whole. Splits it into
// the header and the text between the outer braces.
function splitInlineBody(
	value: string,
): { header: string; body: string } | null {
	if (!value.endsWith("}")) {
		return null;
	}
	const open = indexOfOutsideScripts(value, "{");
	if (open === -1) {
		return null;
	}
	return {
		header: value.substring(0, open).trim(),
		body: value.substring(open + 1, value.length - 1).trim(),
	};
}

function splitOutsideScripts(value: string, ch: string): string[] {
	const parts: string[] = [];
	let start = 0;
	while (true) {
		const idx = indexOfOutsideScripts(value, ch, start);
		if (idx === -1) {
			parts.push(value.substring(start));
			return parts;
		}
		parts.push(value.substring(start, idx));
		start = idx + 1;
	}
}

// Data pack registries whose keyword is also their folder under
// data/<namespace>/. Registries not listed here can be written with
// `json <folder> <name> <value>`.
const registryJsonFiles = [
	"banner_pattern",
	"block_transformer",
	"cat_variant",
	"chicken_variant",
	"context_float_provider",
	"context_int_provider",
	"cow_variant",
	"decorated_pot_pattern",
	"dialog",
	"enchantment_provider",
	"frog_variant",
	"instrument",
	"jukebox_song",
	"painting_variant",
	"pig_variant",
	"slot_source",
	"sulfur_cube_archetype",
	"test_environment",
	"test_instance",
	"timeline",
	"trade_set",
	"trial_spawner",
	"trim_material",
	"trim_pattern",
	"villager_trade",
	"wolf_sound_variant",
	"wolf_variant",
	"world_clock",
	"zombie_nautilus_variant",
];

function tokenId(token: Token): TokenIds {
	switch (token.type) {
		case "Literal":
			return TokenIds.Literal;
		case "BracketOpen":
			return TokenIds.BracketOpen;
		case "BracketClose":
			return TokenIds.BracketClose;
	}
}

function unreachable(token: Token): ParserError {
	switch (token.type) {
		case "Literal":
			return new ParserError(
				format("Unexpected token '{}'", token.v),
				token.pos,
			);
		case "BracketOpen":
			return new ParserError(
				format("Unexpected '{' with data '{}'", token.data ?? ""),
				token.pos,
			);
		case "BracketClose":
			return new ParserError("Unexpected '}'", token.pos);
	}
}

function expect(reader: TokenInput, match: (token: Token) => boolean): void {
	const token = reader.next();
	if (!match(token)) {
		throw unreachable(token);
	}
}

function expectThenData(reader: TokenInput, allowData = true): string | null {
	const token = reader.peek();
	expect(reader, (token) => tokenId(token) === TokenIds.BracketOpen);
	if (token.type === "BracketOpen") {
		if (!allowData && token.data && token.data.length > 0) {
			throw unreachable(token);
		}
		return token.data ?? null;
	}
	return null;
}

function block(
	reader: TokenInput,
	sub: () => void,
	allowData = true,
	onLastToken?: (token: Token) => void,
): string | null {
	const data = expectThenData(reader, allowData) ?? null;
	while (true) {
		if (!reader.hasNext()) {
			throw new ParserError("Unexpected end of file!", reader.last()?.pos ?? null);
		}
		const peek = reader.peek();
		if (peek.type === "BracketClose") {
			if (onLastToken) {
				onLastToken(peek);
			}
			break;
		}
		sub();
	}
	expect(reader, (token) => tokenId(token) === TokenIds.BracketClose);
	return data === "" ? null : data;
}

function readFunction(name: string, reader: TokenInput, pos: PosInfo): AstNode {
	const parts = name.split(" ");
	let appendTo: string | undefined;
	if (parts.length === 2) {
		name = parts[0];
		appendTo = parts[1];
	} else if (parts.length === 1) {
		name = parts[0];
	}
	const body: AstNode[] = [];
	block(
		reader,
		() => {
			body.push(innerParse(reader));
		},
		false,
	);
	return { type: "FunctionDef", pos, name, body, appendTo };
}

function innerParseTemplate(reader: TokenInput): AstNode | null {
	const token = reader.peek();
	if (token.type !== "Literal") {
		throw unreachable(reader.next());
	}
	const value = token.v;
	const pos = token.pos;
	if (value === "load") {
		reader.skip();
		const body: AstNode[] = [];
		block(reader, () => body.push(innerParse(reader)), false);
		return { type: "LoadBlock", pos, body };
	}
	if (value === "tick") {
		reader.skip();
		const body: AstNode[] = [];
		block(reader, () => body.push(innerParse(reader)), false);
		return { type: "TickBlock", pos, body };
	}
	if (value === "with" || StringUtils.startsWithConstExpr(value, "with ")) {
		reader.skip();
		const args = value.substring("with ".length).trim();
		const body: AstNode[] = [];
		block(reader, () => body.push(innerParse(reader)), false);
		return { type: "TemplateOverload", pos, args, body };
	}
	if (
		value === "tld with" ||
		StringUtils.startsWithConstExpr(value, "tld with ")
	) {
		reader.skip();
		const args = value.substring("tld with ".length).trim();
		const body: AstNode[] = [];
		block(reader, () => body.push(parseTLD(reader)), false);
		return { type: "TemplateOverload", pos, args, body, isTld: true };
	}
	if (isEscapedComment(value) || StringUtils.startsWithConstExpr(value, "#")) {
		reader.skip();
		return null;
	}
	throw unreachable(reader.next());
}

function readTemplate(name: string, reader: TokenInput, pos: PosInfo): AstNode {
	const body: AstNode[] = [];
	block(
		reader,
		() => {
			const node = innerParseTemplate(reader);
			if (node) {
				body.push(node);
			}
		},
		false,
	);
	return { type: "TemplateDef", pos, name, body };
}

function parseMcbFile(reader: TokenInput): AstNode[] {
	const nodes: AstNode[] = [];
	while (reader.hasNext()) {
		nodes.push(parseTLD(reader));
	}
	return nodes;
}

function parseMcbtFile(reader: TokenInput): AstNode[] {
	const nodes: AstNode[] = [];
	while (reader.hasNext()) {
		const token = reader.next();
		if (token.type === "Literal") {
			const value = token.v;
			if (StringUtils.startsWithConstExpr(value, "template ")) {
				const name = value.substring("template ".length).trim();
				nodes.push(readTemplate(name, reader, token.pos));
			} else if (isEscapedComment(value)) {
				throw new ParserError(ESCAPED_COMMENT_SCOPE_ERROR, token.pos);
			} else if (StringUtils.startsWithConstExpr(value, "#")) {
				nodes.push({ type: "Comment", pos: token.pos, value });
			} else if (StringUtils.startsWithConstExpr(value, "import ")) {
				nodes.push({
					type: "Import",
					pos: token.pos,
					name: value.substring("import ".length),
				});
			} else {
				throw unreachable(token);
			}
		} else {
			throw unreachable(token);
		}
	}
	return nodes;
}

function parseTLD(reader: TokenInput): AstNode {
	const token = reader.next();
	if (token.type !== "Literal") {
		throw unreachable(token);
	}
	const value = token.v;
	const pos = token.pos;
	if (StringUtils.startsWithConstExpr(value, "function ")) {
		const name = value.substring("function ".length).trim();
		return readFunction(name, reader, pos);
	}
	if (StringUtils.startsWithConstExpr(value, "clock ")) {
		const payload = value.substring("clock ".length).trim();
		const spaceIdx = payload.indexOf(" ");
		if (spaceIdx === -1) {
			throw new ParserError(
				"Expected a name and a time for the clock command",
				pos,
			);
		}
		const name = payload.substring(0, spaceIdx + 1).trim();
		const time = payload.substring(spaceIdx).trim();
		const body: AstNode[] = [];
		block(reader, () => body.push(innerParse(reader)));
		return { type: "ClockExpr", pos, name, time, body };
	}
	if (StringUtils.startsWithConstExpr(value, "import ")) {
		return { type: "Import", pos, name: value.substring("import ".length) };
	}
	if (
		StringUtils.startsWithConstExpr(value, "dir ") &&
		reader.hasNext() &&
		reader.peek().type === "BracketOpen"
	) {
		const body: AstNode[] = [];
		const data = block(reader, () => body.push(parseTLD(reader)), false);
		if (data !== null) {
			throw unreachable(token);
		}
		return {
			type: "Directory",
			pos,
			name: value.substring("dir ".length),
			body,
		};
	}
	if (StringUtils.startsWithConstExpr(value, "<%%")) {
		const script: Token[] = [];
		while (true) {
			if (!reader.hasNext()) {
				throw new ParserError("Unexpected end of file!", reader.last()?.pos ?? null);
			}
			const peek = reader.peek();
			if (peek.type === "Literal" && peek.v === "%%>") {
				reader.skip();
				break;
			}
			script.push(reader.next());
		}
		return { type: "MultiLineScript", pos, value: script };
	}
	if (isEscapedComment(value)) {
		throw new ParserError(ESCAPED_COMMENT_SCOPE_ERROR, pos);
	}
	if (StringUtils.startsWithConstExpr(value, "#")) {
		return { type: "Comment", pos, value };
	}
	if (StringUtils.startsWithConstExpr(value, "REPEAT")) {
		return parserCompilerLoop(value, pos, reader, () => parseTLD(reader));
	}
	if (StringUtils.startsWithConstExpr(value, "IF")) {
		return parseCompileTimeIf(value, pos, reader, () => parseTLD(reader));
	}
	if (StringUtils.startsWithConstExpr(value, "tag ")) {
		const inline = splitInlineBody(value);
		const parts = (inline?.header ?? value)
			.substring("tag ".length)
			.trim()
			.split(" ")
			.filter((x) => x !== "");
		const type = parts.shift() ?? "";
		const name = parts.shift() ?? "";
		const replace = (parts.shift() ?? "") === "replace";
		const entries: AstNode[] = [];
		if (inline) {
			for (const part of splitOutsideScripts(inline.body, ",")) {
				const entry = part.trim();
				if (entry.length === 0) {
					continue;
				}
				entries.push(
					entry.startsWith("#")
						? { type: "Comment", pos, value: entry }
						: {
								type: "Raw",
								pos,
								value: entry,
								continuations: [],
								isMacro: false,
							},
				);
			}
		} else {
			block(reader, () => entries.push(innerParse(reader)));
		}
		return {
			type: "JsonFile",
			pos,
			name,
			info: { kind: "Tag", subType: type, replace, entries },
		};
	}
	if (StringUtils.startsWithConstExpr(value, "json ")) {
		const { words, entries } = readJsonFile(
			token,
			reader,
			3,
			"json <subfolder> <name> <value>",
		);
		return {
			type: "JsonFile",
			pos,
			name: words[2],
			info: { kind: "Generic", subFolder: words[1], entries },
		};
	}
	if (
		registryJsonFiles.some((registry) =>
			StringUtils.startsWithConstExpr(value, `${registry} `),
		)
	) {
		const { words, entries } = readJsonFile(
			token,
			reader,
			2,
			"<type> <name> <value>",
		);
		return {
			type: "JsonFile",
			pos,
			name: words[1],
			info: { kind: "Generic", subFolder: words[0], entries },
		};
	}
	if (
		JSON_FILE_TYPES.some((type) =>
			StringUtils.startsWithConstExpr(value, `${type} `),
		)
	) {
		const { words, entries } = readJsonFile(
			token,
			reader,
			2,
			"<type> <name> <value>",
		);
		return {
			type: "JsonFile",
			pos,
			name: words[1],
			info: createJsonInfo(words[0], entries, pos),
		};
	}
	if (StringUtils.startsWithConstExpr(value, "worldgen ")) {
		const { words, entries } = readJsonFile(
			token,
			reader,
			3,
			"worldgen <type> <name> <value>",
		);
		return {
			type: "JsonFile",
			pos,
			name: words[2],
			info: { kind: "WorldGen", subType: words[1], entries },
		};
	}
	return readRaw(pos, value, reader, false);
}

const JSON_FILE_TYPES = [
	"advancement",
	"enchantment",
	"item_modifier",
	"loot_table",
	"predicate",
	"recipe",
	"chat_type",
	"damage_type",
	"dimension",
	"dimension_type",
];
const JSON_CONTROL_REGEX = /^(?:IF|REPEAT)[\s(]/;
const JSON_ELSE_REGEX = /^ELSE(?:[\s{]|$)/;

interface JsonLine {
	text: string;
	pos: PosInfo;
}

function isSameLine(a: Token, b: Token): boolean {
	return a.pos.line === b.pos.line && a.pos.file === b.pos.file;
}

/** Fallback for tokens without a `raw` source line. */
function tokenText(token: Token): string {
	switch (token.type) {
		case "Literal":
			return token.v;
		case "BracketOpen":
			return token.data ? `{ ${token.data}` : "{";
		case "BracketClose":
			return "}";
	}
}

/** Consumes the rest of `first`'s source line and returns the line's text. */
function readJsonLine(first: Token, reader: TokenInput): JsonLine {
	const tokens = [first];
	while (reader.hasNext() && isSameLine(reader.peek(), first)) {
		tokens.push(reader.next());
	}
	const text = first.raw ?? tokens.map(tokenText).join(" ");
	return { text: text.trimEnd(), pos: first.pos };
}

function peekLineText(reader: TokenInput): string {
	const token = reader.peek();
	return (token.raw ?? tokenText(token)).trim();
}

/**
 * Splits `count` whitespace-separated words off the front of `text`.
 * `<% %>` expressions stay whole, and `{` or `[` ends a word.
 */
function splitWords(
	text: string,
	count: number,
): { words: string[]; restIndex: number } {
	const words: string[] = [];
	let i = 0;
	while (words.length < count) {
		while (i < text.length && /\s/.test(text[i])) i++;
		const start = i;
		while (i < text.length && !/[\s{[]/.test(text[i])) {
			if (text.startsWith("<%", i)) {
				const end = text.indexOf("%>", i + 2);
				i = end === -1 ? text.length : end + 2;
			} else {
				i++;
			}
		}
		if (i === start) break;
		words.push(text.substring(start, i));
	}
	while (i < text.length && /\s/.test(text[i])) i++;
	return { words, restIndex: i };
}

/** Tracks bracket depth across JSON lines, skipping strings, comments and `<% %>` expressions. */
class JsonDepthScanner {
	depth = 0;
	inBlockComment = false;

	scan(text: string): void {
		let i = 0;
		while (i < text.length) {
			if (this.inBlockComment) {
				const end = text.indexOf("*/", i);
				if (end === -1) return;
				this.inBlockComment = false;
				i = end + 2;
				continue;
			}
			const char = text[i];
			if (char === '"' || char === "'") {
				i = JsonDepthScanner.skipString(text, i);
			} else if (text.startsWith("<%", i)) {
				const end = text.indexOf("%>", i + 2);
				if (end === -1) return;
				i = end + 2;
			} else if (text.startsWith("//", i)) {
				return;
			} else if (text.startsWith("/*", i)) {
				this.inBlockComment = true;
				i += 2;
			} else {
				if (char === "{" || char === "[") this.depth++;
				else if (char === "}" || char === "]") this.depth--;
				i++;
			}
		}
	}

	private static skipString(text: string, start: number): number {
		const quote = text[start];
		let i = start + 1;
		while (i < text.length) {
			if (text[i] === "\\") {
				i += 2;
			} else if (text[i] === quote) {
				return i + 1;
			} else {
				i++;
			}
		}
		return i;
	}
}

function jsonRaw(line: JsonLine): AstNode {
	return {
		type: "Raw",
		pos: line.pos,
		value: line.text,
		continuations: [],
		isMacro: false,
	};
}

/**
 * Reads a JSON file header (`wordCount` words, then the value) starting at `token`,
 * followed by the JSON body.
 */
function readJsonFile(
	token: Token & { type: "Literal" },
	reader: TokenInput,
	wordCount: number,
	usage: string,
): { words: string[]; entries: AstNode[] } {
	const line = readJsonLine(token, reader);
	const headerStart = Math.max(0, line.text.indexOf(token.v));
	const header = line.text.substring(headerStart);
	const { words, restIndex } = splitWords(header, wordCount);
	if (words.length < wordCount) {
		throw new ParserError(format("Expected '{}'", usage), token.pos);
	}
	const first: JsonLine = {
		text: header.substring(restIndex),
		pos: { ...token.pos, col: token.pos.col + headerStart + restIndex },
	};
	return { words, entries: parseJsonBody(reader, first, usage) };
}

/** Reads a JSON value whose first line is `first`. */
function parseJsonBody(
	reader: TokenInput,
	first: JsonLine,
	usage: string,
): AstNode[] {
	if (first.text.length === 0) {
		throw new ParserError(format("Expected '{}'", usage), first.pos);
	}
	const nodes = [jsonRaw(first)];
	// Anything other than a bracketed root is a single-line value, like `<% %>`.
	if (first.text[0] !== "{" && first.text[0] !== "[") {
		return nodes;
	}
	const scanner = new JsonDepthScanner();
	scanner.scan(first.text);
	if (scanner.depth > 0) {
		nodes.push(...parseJsonLines(reader, scanner, 0, null, first.pos).nodes);
	}
	return nodes;
}

/**
 * Reads JSON lines until the bracket depth drops back to `baseDepth`, or, inside an
 * IF/ELSE/REPEAT block (`blockPos` set), until the line that closes the block.
 */
function parseJsonLines(
	reader: TokenInput,
	scanner: JsonDepthScanner,
	baseDepth: number,
	blockPos: PosInfo | null,
	openPos: PosInfo,
): { nodes: AstNode[]; closing: JsonLine } {
	const nodes: AstNode[] = [];
	while (true) {
		if (!reader.hasNext()) {
			throw new ParserError(
				blockPos ? "Expected '}' to close this block" : "Unexpected end of file in JSON value",
				openPos,
			);
		}
		const line = readJsonLine(reader.next(), reader);
		const text = line.text.trim();
		if (!scanner.inBlockComment) {
			if (text.startsWith("#")) {
				continue;
			}
			if (JSON_CONTROL_REGEX.test(text) && text.endsWith("{")) {
				nodes.push(parseJsonControl(reader, scanner, line, text));
				continue;
			}
			if (blockPos && text.startsWith("}") && scanner.depth === baseDepth) {
				return {
					nodes,
					closing: { text: text.substring(1).trim(), pos: line.pos },
				};
			}
		}
		nodes.push(jsonRaw(line));
		scanner.scan(line.text);
		if (scanner.depth < baseDepth) {
			throw new ParserError(
				blockPos
					? "This closes a bracket opened outside the IF/ELSE/REPEAT block"
					: "Unbalanced closing bracket",
				line.pos,
			);
		}
		if (!blockPos && scanner.depth === baseDepth) {
			return { nodes, closing: line };
		}
	}
}

/** Reads an IF/ELSE or REPEAT block inside a JSON value. `text` is its trimmed header line. */
function parseJsonControl(
	reader: TokenInput,
	scanner: JsonDepthScanner,
	line: JsonLine,
	text: string,
): AstNode {
	const header = text.substring(0, text.length - 1).trim();
	const body = parseJsonLines(reader, scanner, scanner.depth, line.pos, line.pos);
	if (StringUtils.startsWithConstExpr(header, "REPEAT")) {
		if (body.closing.text.length > 0) {
			throw new ParserError(
				format("Unexpected '{}' after '}'", body.closing.text),
				body.closing.pos,
			);
		}
		return createCompilerLoop(header, line.pos, body.nodes);
	}
	const elseExpressions: CompileTimeElse[] = [];
	let closing = body.closing;
	while (true) {
		let elseLine = closing;
		if (elseLine.text.length === 0) {
			if (!reader.hasNext() || !JSON_ELSE_REGEX.test(peekLineText(reader))) {
				break;
			}
			const next = readJsonLine(reader.next(), reader);
			elseLine = { text: next.text.trim(), pos: next.pos };
		}
		if (!JSON_ELSE_REGEX.test(elseLine.text) || !elseLine.text.endsWith("{")) {
			throw new ParserError(
				format("Unexpected '{}' after '}'", elseLine.text),
				elseLine.pos,
			);
		}
		let condition = elseLine.text
			.substring("ELSE".length, elseLine.text.length - 1)
			.trim();
		if (StringUtils.startsWithConstExpr(condition, "IF")) {
			condition = condition.substring("IF".length).trim();
		}
		const elseBody = parseJsonLines(
			reader,
			scanner,
			scanner.depth,
			elseLine.pos,
			elseLine.pos,
		);
		elseExpressions.push({
			condition: condition.length > 0 ? condition : null,
			node: elseBody.nodes,
		});
		closing = elseBody.closing;
	}
	return {
		type: "CompileTimeIf",
		pos: line.pos,
		expression: header.substring("IF".length).trim(),
		body: body.nodes,
		elseExpressions,
	};
}

function createJsonInfo(
	type: string,
	entries: AstNode[],
	pos: PosInfo,
): JsonTagType {
	switch (type) {
		case "advancement":
			return { kind: "Advancement", entries };
		case "item_modifier":
			return { kind: "ItemModifier", entries };
		case "loot_table":
			return { kind: "LootTable", entries };
		case "predicate":
			return { kind: "Predicate", entries };
		case "recipe":
			return { kind: "Recipe", entries };
		case "chat_type":
			return { kind: "ChatType", entries };
		case "damage_type":
			return { kind: "DamageType", entries };
		case "dimension":
			return { kind: "Dimension", entries };
		case "dimension_type":
			return { kind: "DimensionType", entries };
		case "enchantment":
			return { kind: "Enchantment", entries };
		default:
			throw new ParserError(
				format("Unsupported json file type '{}'", type),
				pos,
			);
	}
}

function innerParse(reader: TokenInput): AstNode {
	const token = reader.peek();
	if (token.type === "Literal") {
		reader.next();
		const pos = token.pos;
		let value = token.v;
		const isMacro = value.startsWith("$");
		if (isMacro) {
			value = value.substring(1);
		}
		if (value === "<%%") {
			const script: Token[] = [];
			while (true) {
				if (!reader.hasNext()) {
					throw new ParserError("Unexpected end of file!", reader.last()?.pos ?? null);
				}
				const next = reader.peek();
				if (next.type === "Literal" && next.v === "%%>") {
					reader.skip();
					break;
				}
				script.push(reader.next());
			}
			return { type: "MultiLineScript", pos, value: script };
		}
		if (StringUtils.startsWithConstExpr(value, "IF")) {
			return parseCompileTimeIf(value, pos, reader, () => innerParse(reader));
		}
		if (StringUtils.startsWithConstExpr(value, "function ")) {
			const payload = value.substring("function ".length);
			const spaceIdx = payload.indexOf(" ");
			const name = payload.substring(
				0,
				spaceIdx === -1 ? payload.length : spaceIdx,
			);
			const data = payload.substring(name.length + 1);
			return { type: "FunctionCall", pos, name, data, isMacro };
		}
		if (StringUtils.startsWithConstExpr(value, "schedule ")) {
			return parseSchedule(value, pos, reader, isMacro);
		}
		if (
			StringUtils.startsWithConstExpr(value, "execute") &&
			(value.charAt("execute".length) === " " ||
				value.charAt("execute".length) === "<")
		) {
			return parseExecute(value, pos, reader, isMacro);
		}
		if (StringUtils.startsWithConstExpr(value, "REPEAT")) {
			return parserCompilerLoop(value, pos, reader, () => innerParse(reader));
		}
		if (isEscapedComment(value) || StringUtils.startsWithConstExpr(value, "#")) {
			// The raw value (including any leading "\#") is preserved so the
			// compiler can apply comment-evaluation rules in a context-aware way
			// (function body vs. tag reference).
			return { type: "Comment", pos, value };
		}
		if (value === "block" || StringUtils.startsWithConstExpr(value, "block ")) {
			const name = value.substring("block ".length).trim();
			const body: AstNode[] = [];
			const data = block(reader, () => body.push(innerParse(reader)));
			return {
				type: "Block",
				pos,
				name: name.length > 0 ? name : undefined,
				body,
				data: data ?? undefined,
				isMacro,
				isInline: false,
			};
		}
		if (StringUtils.startsWithConstExpr(value, "return run")) {
			const sub = value.substring("return run ".length).trim();
			const newPos: PosInfo = {
				file: pos.file,
				line: pos.line,
				col: pos.col + "return run ".length,
			};
			const hadNext = reader.hasNext();
			const peek = hadNext ? reader.peek() : null;
			if (peek && peek.type === "BracketOpen" && sub.length === 0) {
				const body: AstNode[] = [];
				const data = block(reader, () => body.push(innerParse(reader)));
				return {
					type: "ReturnRun",
					pos,
					value: {
						type: "Block",
						pos,
						name: undefined,
						body,
						data: data ?? undefined,
						isMacro: false,
						isInline: false,
					},
					isMacro,
				};
			}
			if (!hadNext && sub.length === 0) {
				throw new ParserError(
					"Expected a command or a block after 'return run'",
					newPos,
				);
			}
			reader.back();
			reader.update({ type: "Literal", v: sub, pos: newPos });
			return { type: "ReturnRun", pos, value: innerParse(reader), isMacro };
		}
		if (value === "tick") {
			const body: AstNode[] = [];
			block(reader, () => body.push(innerParse(reader)), false);
			return { type: "TickBlock", pos, body };
		}
		if (value === "load") {
			const body: AstNode[] = [];
			block(reader, () => body.push(innerParse(reader)), false);
			return { type: "LoadBlock", pos, body };
		}
		if (StringUtils.startsWithConstExpr(value, "eq ")) {
			return { type: "EqCommand", pos, command: value.substring("eq ".length) };
		}
		return readRaw(pos, value, reader, isMacro);
	}
	if (token.type === "BracketOpen") {
		const body: AstNode[] = [];
		const data = block(reader, () => body.push(innerParse(reader)));
		return {
			type: "Block",
			pos: token.pos,
			name: undefined,
			body,
			data: data ?? undefined,
			isMacro: false,
			isInline: false,
		};
	}
	throw unreachable(token);
}

function readRaw(
	pos: PosInfo,
	v: string,
	reader: TokenInput,
	isMacro: boolean,
): AstNode {
	if (!reader.hasNext()) {
		return { type: "Raw", pos, value: v, continuations: [], isMacro };
	}
	const continuations: AstNode[] = [];
	let line = pos.line;
	while (true) {
		if (!reader.hasNext()) {
			throw new ParserError("Unexpected end of file!", reader.last()?.pos ?? null);
		}
		const peek = reader.peek();
		if (peek.type === "Literal" && peek.pos.line === line) {
			reader.skip();
			continuations.push({
				type: "Raw",
				pos: peek.pos,
				value: peek.v,
				continuations: [],
				isMacro: false,
			});
		} else if (peek.type === "BracketOpen" && peek.pos.line === line) {
			const body: AstNode[] = [];
			const data = block(reader, () => body.push(innerParse(reader)));
			continuations.push({
				type: "Block",
				pos: peek.pos,
				name: undefined,
				body,
				data: data ?? undefined,
				isMacro: false,
				isInline: false,
			});
			let last = reader.last();
			if(last)
				line = last.pos.line;
		} else if (peek.type === "BracketClose" && peek.pos.line === line) {
			throw unreachable({ type: "Literal", v, pos } as Token);
		} else {
			break;
		}
	}
	return { type: "Raw", pos, value: v, continuations, isMacro };
}

function parseCompileTimeIf(
	v: string,
	pos: PosInfo,
	reader: TokenInput,
	arg: () => AstNode,
): AstNode {
	const expression = v.substring("IF".length).trim();
	const body: AstNode[] = [];
	block(reader, () => body.push(arg()), false);
	const elseExpressions: CompileTimeElse[] = [];
	while (reader.hasNext()) {
		const peek = reader.peek();
		if (
			peek.type === "Literal" &&
			(peek.v === "ELSE" || StringUtils.startsWithConstExpr(peek.v, "ELSE "))
		) {
			reader.skip();
			let condition =
				peek.v === "ELSE" ? null : peek.v.substring("ELSE ".length).trim();
			if (condition && StringUtils.startsWithConstExpr(condition, "IF")) {
				condition = condition.substring("IF".length).trim();
			}
			const elseBody: AstNode[] = [];
			block(reader, () => elseBody.push(arg()), false);
			elseExpressions.push({ condition, node: elseBody });
		} else {
			break;
		}
	}
	return { type: "CompileTimeIf", pos, expression, body, elseExpressions };
}

function parserCompilerLoop(
	v: string,
	pos: PosInfo,
	reader: TokenInput,
	handler: () => AstNode,
): AstNode {
	const body: AstNode[] = [];
	block(reader, () => body.push(handler()));
	return createCompilerLoop(v, pos, body);
}

function createCompilerLoop(v: string, pos: PosInfo, body: AstNode[]): AstNode {
	const match = loopRegExp.exec(v);
	if (match) {
		const loop = match[1];
		const as = match[2];
		const vars =
			as.length === 0 ? undefined : as.split(",").map((x) => x.trim());
		return { type: "CompileTimeLoop", pos, expression: loop, as: vars, body };
	}
	return { type: "CompileTimeLoop", pos, expression: v, as: undefined, body };
}

function parseExecute(
	v: string,
	pos: PosInfo,
	reader: TokenInput,
	isMacro: boolean,
): AstNode {
	if (reader.hasNext() && reader.peek().type === "BracketOpen") {
		const body: AstNode[] = [];
		if (!v.endsWith("run") && executeRegExp.test(v)) {
			const match = executeRegExp.exec(v);
			if (match) {
				const insertPos: PosInfo = {
					file: pos.file,
					line: pos.line,
					col: pos.col + match.index + match[0].length,
				};
				reader.insert({
					type: "Literal",
					v: v.substring(match.index + match[0].length).trimLeft(),
					pos: insertPos,
				});
				return {
					type: "Execute",
					pos,
					command: v.substring(0, match.index + 3).trimRight(),
					value: innerParse(reader),
					isMacro,
				};
			}
		}
		let close: Token | undefined;
		const data = block(
			reader,
			() => body.push(innerParse(reader)),
			true,
			(token) => {
				close = token;
			},
		);
		const continuations: AstNode[] = [];
		while (reader.hasNext()) {
			const peek = reader.peek();
			if (peek.type !== "Literal") {
				break;
			}
			const text = peek.v;
			const blockPos = peek.pos;
			if (text === "else $run" || text === "else run") {
				reader.skip();
				const elseBody: AstNode[] = [];
				const elseData = block(reader, () => elseBody.push(innerParse(reader)));
				continuations.push({
					type: "Block",
					pos: blockPos,
					name: undefined,
					body: elseBody,
					data: elseData ?? undefined,
					isMacro: text === "else $run",
					isInline: false,
				});
				continue;
			}
			if (
				StringUtils.startsWithConstExpr(text, "else $") &&
				text.endsWith("run")
			) {
				reader.skip();
				const command = text.substring("else $".length).trim();
				const elseBody: AstNode[] = [];
				const elseData = block(reader, () => elseBody.push(innerParse(reader)));
				continuations.push({
					type: "ExecuteBlock",
					pos: {
						file: blockPos.file,
						line: blockPos.line,
						col: blockPos.col + 5,
					},
					execute: command,
					data: elseData ?? undefined,
					body: elseBody,
					continuations: undefined,
					isMacro: true,
				});
				continue;
			}
			if (
				StringUtils.startsWithConstExpr(text, "else ") &&
				text.endsWith("run")
			) {
				reader.skip();
				const command = text.substring("else ".length).trim();
				const elseBody: AstNode[] = [];
				const elseData = block(reader, () => elseBody.push(innerParse(reader)));
				continuations.push({
					type: "ExecuteBlock",
					pos: {
						file: blockPos.file,
						line: blockPos.line,
						col: blockPos.col + 5,
					},
					execute: command,
					data: elseData ?? undefined,
					body: elseBody,
					continuations: undefined,
					isMacro: false,
				});
				continue;
			}
			break;
		}
		let tail: AstNode | undefined;
		if (continuations.length === 0 && close && reader.hasNext()) {
			const peek = reader.peek();
			if (peek.type === "Literal" && peek.pos.line === close.pos.line) {
				reader.skip();
				tail = parseExecute(peek.v, peek.pos, reader, false);
			}
		}
		return {
			type: "ExecuteBlock",
			pos,
			execute: v,
			data: data ?? undefined,
			body,
			continuations: continuations.length > 0 ? continuations : undefined,
			tail,
			isMacro,
		};
	}
	const match = executeRegExp.exec(v);
	if (match) {
		const insertPos: PosInfo = {
			file: pos.file,
			line: pos.line,
			col: pos.col + match.index + match[0].length,
		};
		reader.insert({
			type: "Literal",
			v: v.substring(match.index + match[0].length).trimLeft(),
			pos: insertPos,
		});
		return {
			type: "Execute",
			pos,
			command: v.substring(0, match.index + 3).trimRight(),
			value: innerParse(reader),
			isMacro,
		};
	}
	return readRaw(pos, v, reader, isMacro);
}

function parseSchedule(
	v: string,
	pos: PosInfo,
	reader: TokenInput,
	isMacro: boolean,
): AstNode {
	let payload = v.substring("schedule ".length).trim();
	if (StringUtils.startsWithConstExpr(payload, "function ")) {
		const target = payload.substring("function ".length);
		const spaceIdx = target.indexOf(" ");
		const name = target.substring(
			0,
			spaceIdx === -1 ? target.length : spaceIdx,
		);
		let delay = spaceIdx === -1 ? null : target.substring(name.length + 1);
		let mode = "replace";
		if (delay && delay.endsWith(" append")) {
			mode = "append";
			delay = delay.substring(0, delay.length - " append".length);
		}
		if (delay && delay.endsWith(" replace")) {
			mode = "replace";
			delay = delay.substring(0, delay.length - " replace".length);
		}
		if (!delay) {
			throw new ParserError(
				"Expected delay after function name in schedule command",
				pos,
			);
		}
		return { type: "ScheduleCall", pos, delay, target: name, mode, isMacro };
	}
	if (StringUtils.startsWithConstExpr(payload, "clear ")) {
		return {
			type: "ScheduleClear",
			pos,
			target: payload.substring("clear ".length),
			isMacro,
		};
	}
	const spaceIdx = payload.indexOf(" ");
	const delay = spaceIdx === -1 ? payload : payload.substring(0, spaceIdx);
	let mode = "append";
	if (payload.endsWith(" append")) {
		mode = "append";
		payload = payload.substring(0, payload.length - " append".length);
	}
	if (payload.endsWith(" replace")) {
		mode = "replace";
		payload = payload.substring(0, payload.length - " replace".length);
	}
	if (reader.peek().type !== "BracketOpen") {
		throw new ParserError(
			"Expected { after delay in schedule block command",
			pos,
		);
	}
	const body: AstNode[] = [];
	block(reader, () => body.push(innerParse(reader)));
	return { type: "ScheduleBlock", pos, delay, blockType: mode, body, isMacro };
}

export class Parser {
	static parseMcbFile(tokens: Token[]): AstNode[] {
		const reader = new ArrayInput<Token>(tokens);
		return parseMcbFile(reader);
	}

	static parseMcbtFile(tokens: Token[]): AstNode[] {
		const reader = new ArrayInput<Token>(tokens);
		return parseMcbtFile(reader);
	}

	static parseInline(tokens: Token[]): AstNode[] {
		const reader = new ArrayInput<Token>(tokens);
		const nodes: AstNode[] = [];
		while (reader.hasNext()) {
			nodes.push(innerParse(reader));
		}
		return nodes;
	}

	static parseInlineTLD(tokens: Token[]): AstNode[] {
		const reader = new ArrayInput<Token>(tokens);
		const nodes: AstNode[] = [];
		while (reader.hasNext()) {
			nodes.push(parseTLD(reader));
		}
		return nodes;
	}
}

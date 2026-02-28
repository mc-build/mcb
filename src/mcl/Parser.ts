import prettier from "@prettier/sync";
import { ArrayInput } from "./ArrayInput";
import { ParserError } from "./error/ParserError";
import { StringUtils } from "../strutils/StringUtils";
import {
	AST_NODE_TYPE,
	AstNode,
	AstNodes,
	CompileTimeIfElseExpression,
	getAstNodeTypeName,
	JsonTagType,
} from "./AstNode";
import {
	getTokenTypeName,
	stringifyToken,
	Token,
	TOKEN_TYPE,
	TokenizerResult,
	Tokens,
} from "./Tokenizer";
import { TokenSequence } from "./TokenSequence";
import { SyntaxPointerError } from "./SyntaxPointerError";
import { StreamPosition } from "./StringStream";
import { writeFileSync } from "fs";

type TokenInput = ArrayInput<Token>;
type CompileTimeElse = { condition: string | null; node: AstNode[] };

const loopRegExp = /(REPEAT\s*\(.+?\))\s\s*as\s\s*([a-zA-Z,\s]+)/;
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

function unreachable(token: Token): ParserError {
	switch (token.type) {
		case "Literal":
			return new ParserError(
				format(
					"Unexpected token '{}' at {}:{}:{}",
					token.v,
					token.pos.file,
					token.pos.line,
					token.pos.col,
				),
			);
		case "BracketOpen":
			return new ParserError(
				format(
					"Unexpected '{' with data '{}' at {}:{}:{}",
					token.data ?? "",
					token.pos.file,
					token.pos.line,
					token.pos.col,
				),
			);
		case "BracketClose":
			return new ParserError(
				format(
					"Unexpected '}' at {}:{}:{}",
					token.pos.file,
					token.pos.line,
					token.pos.col,
				),
			);
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
			throw new ParserError("Unexpected end of file!");
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
	return { type: "FunctionDef", pos, path: name, body, appendTo };
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
	if (StringUtils.startsWithConstExpr(value, "#")) {
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
	return { type: "TemplateDef", pos, path: name, body };
}

function json(reader: TokenInput): AstNode {
	const start = reader.peek().pos;
	let depth = 0;
	let result = "";
	do {
		if (!reader.hasNext()) {
			throw new ParserError("Unexpected end of file!");
		}
		const token = reader.next();
		if (token.type === "BracketOpen") {
			result += "{" + (token.data ?? "");
			depth++;
		} else if (token.type === "BracketClose") {
			depth--;
			result += "}";
		} else {
			result += token.v;
		}
	} while (depth > 0);
	return {
		type: "Raw",
		pos: start,
		value: result,
		continuations: [],
		isMacro: false,
	};
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
			} else if (StringUtils.startsWithConstExpr(value, "#")) {
				nodes.push({ type: "Comment", pos: token.pos, value });
			} else if (StringUtils.startsWithConstExpr(value, "import ")) {
				nodes.push({
					type: "Import",
					pos: token.pos,
					path: value.substring("import ".length),
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
				format(
					'"Expected a name and a time for the clock command" at {}:{}:{}',
					pos.file,
					pos.line,
					pos.col,
				),
			);
		}
		const name = payload.substring(0, spaceIdx + 1).trim();
		const time = payload.substring(spaceIdx).trim();
		const body: AstNode[] = [];
		block(reader, () => body.push(innerParse(reader)));
		return { type: "ClockExpr", pos, path: name, time, body };
	}
	if (StringUtils.startsWithConstExpr(value, "import ")) {
		return { type: "Import", pos, path: value.substring("import ".length) };
	}
	if (
		StringUtils.startsWithConstExpr(value, "dir ") &&
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
			path: value.substring("dir ".length),
			body,
		};
	}
	if (StringUtils.startsWithConstExpr(value, "<%%")) {
		const script: Token[] = [];
		while (true) {
			if (!reader.hasNext()) {
				throw new ParserError("Unexpected end of file!");
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
		const parts = value.substring("tag ".length).trim().split(" ");
		const type = parts.shift() ?? "";
		const name = parts.shift() ?? "";
		const replace = (parts.shift() ?? "") === "replace";
		const entries: AstNode[] = [];
		block(reader, () => entries.push(innerParse(reader)));
		return {
			type: "JsonFile",
			pos,
			path: name,
			info: { kind: "Tag", subType: type, replace, entries },
		};
	}
	if (
		[
			"advancement ",
			"enchantment ",
			"item_modifier ",
			"loot_table ",
			"predicate ",
			"recipe ",
			"chat_type ",
			"damage_type ",
			"dimension ",
			"dimension_type ",
		].some((prefix) => StringUtils.startsWithConstExpr(value, prefix))
	) {
		return readPlainJsonFile(value, pos, reader);
	}
	if (StringUtils.startsWithConstExpr(value, "worldgen ")) {
		let payload = value.substring("worldgen ".length).trim();
		const subtype = payload.substring(0, payload.indexOf(" "));
		payload = payload.substring(payload.indexOf(" ") + 1);
		const entries: AstNode[] = [];
		block(reader, () => entries.push(innerParse(reader)));
		return {
			type: "JsonFile",
			pos,
			path: payload,
			info: { kind: "WorldGen", subType: subtype, name: payload, entries },
		};
	}
	throw unreachable(token);
}

function readPlainJsonFile(
	v: string,
	pos: PosInfo,
	reader: TokenInput,
): AstNode {
	const bits = v.split(" ").filter((x) => x !== "");
	const type = bits.shift() ?? "";
	const name = bits.shift() ?? "";
	const entries: AstNode[] = [];
	block(reader, () => entries.push(json(reader)));
	return {
		type: "JsonFile",
		pos,
		path: name,
		info: createJsonInfo(type, entries, pos),
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
				format(
					"\"Unsupported json file type '{}' at {}:{}:{}",
					type,
					pos.file,
					pos.line,
					pos.col,
				),
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
					throw new ParserError("Unexpected end of file!");
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
			return { type: "FunctionCall", pos, path: name, data, isMacro };
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
		if (StringUtils.startsWithConstExpr(value, "#")) {
			return { type: "Comment", pos, value };
		}
		if (value === "block" || StringUtils.startsWithConstExpr(value, "block ")) {
			const name = value.substring("block ".length).trim();
			const body: AstNode[] = [];
			const data = block(reader, () => body.push(innerParse(reader)));
			return {
				type: "Block",
				pos,
				path: name.length > 0 ? name : undefined,
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
			const peek = reader.peek();
			if (peek.type === "BracketOpen" && sub.length === 0) {
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
			return { type: "EqCommand", pos, tokens: value.substring("eq ".length) };
		}
		return readRaw(pos, value, reader, isMacro);
	}
	if (token.type === "BracketOpen") {
		const body: AstNode[] = [];
		const data = block(reader, () => body.push(innerParse(reader)));
		return {
			type: "Block",
			pos: token.pos,
			path: undefined,
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
	const line = pos.line;
	while (true) {
		if (!reader.hasNext()) {
			throw new ParserError("Unexpected end of file!");
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
				path: undefined,
				body,
				data: data ?? undefined,
				isMacro: false,
				isInline: false,
			});
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
	const match = loopRegExp.exec(v);
	if (match) {
		const loop = match[1];
		const as = match[2];
		const vars =
			as.length === 0 ? undefined : as.split(",").map((x) => x.trim());
		return {
			type: "CompileTimeLoop",
			pos,
			expression: loop,
			varName: vars,
			body,
		};
	}
	return {
		type: "CompileTimeLoop",
		pos,
		expression: v,
		varName: undefined,
		body,
	};
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
					tokens: v.substring(0, match.index + 3).trimRight(),
					value: innerParse(reader),
					isMacro,
				};
			}
		}
		const data = block(reader, () => body.push(innerParse(reader)));
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
					path: undefined,
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
		return {
			type: "ExecuteBlock",
			pos,
			execute: v,
			data: data ?? undefined,
			body,
			continuations: continuations.length > 0 ? continuations : undefined,
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
			tokens: v.substring(0, match.index + 3).trimRight(),
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
				format(
					'"Expected delay after function name in schedule command" at {}:{}:{}',
					pos.file,
					pos.line,
					pos.col,
				),
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
		throw new ParserError("Expected { after delay in schedule block command");
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

// region Keywords
const enum KEYWORDS {
	FUNCTION = "function",
	BLOCK = "block",
	TEMPLATE = "template",
	LOAD = "load",
	TICK = "tick",
	CLOCK = "clock",
	DIR = "dir",
	FOLDER = "folder",
	IMPORT = "import",
	JSON = "json",
	TAG = "tag",

	COMPILE_TIME_IF = "IF",
	COMPILE_TIME_ELSE = "ELSE",
	COMPILE_TIME_REPEAT = "REPEAT",
	COMPILE_TIME_REPEAT_AS = "as",

	EXECUTE = "execute",
	EXECUTE_IF = "if",
	EXECUTE_UNLESS = "unless",
	EXECUTE_ELSE = "else",
	EXECUTE_RUN = "run",

	SCHEDULE = "schedule",
	SCHEDULE_REPLACE = "replace",
	SCHEDULE_APPEND = "append",
}

const namespaceRegex = /^(?:[a-z0-9_.-]+:)?[a-z0-9_/.-]+$/;

export class NewParser extends TokenSequence {
	source: string;

	constructor(tokenizerResult: TokenizerResult) {
		super(tokenizerResult.tokens);
		this.source = tokenizerResult.source;
	}

	/**
	 * Throws an error indicating that the current token was unexpected.
	 */
	unexpected(description?: string): never {
		description = description ? ` ${description}` : ``;
		switch (this.item.type) {
			case TOKEN_TYPE.LITERAL:
				throw new SyntaxPointerError(
					`Unexpected literal ${JSON.stringify(this.item.content)}${description}`,
					this.source,
					this.item.line,
					this.item.column,
				);

			default:
				throw new SyntaxPointerError(
					`Unexpected token of type ${getTokenTypeName(this.item.type)}${description}`,
					this.source,
					this.item.line,
					this.item.column,
				);
		}
	}

	/**
	 * Throws an error indicating that the current token was not what was expected.
	 */
	expected(toBe: string, description?: string, butFound?: string): never {
		description = description ? ` ${description},` : ``;
		throw new SyntaxPointerError(
			`Expected ${toBe}${description} but found ${butFound ?? getTokenTypeName(this.item.type)}`,
			this.source,
			this.item.line,
			this.item.column,
		);
	}

	/**
	 * Expects the current token to be of the given type. If not, throws an error.
	 * @param advance If true (default), advance to the next token if the expectation is met.
	 */
	expect(toBe: TOKEN_TYPE, description: string, advance = true) {
		if (this.item.type !== toBe) {
			throw new SyntaxPointerError(
				`Expected ${description} but found ${getTokenTypeName(this.item.type)}`,
				this.source,
				this.item.line,
				this.item.column,
			);
		}
		if (advance) this.index++;
	}

	/**
	 * Expects the current token to be a literal with the given content. If not, throws an error.
	 * @param advance If true (default), advance to the next token if the expectation is met.
	 */
	expectLiteral(toBe: string | string[], description: string, advance = true) {
		if (this.item.type !== TOKEN_TYPE.LITERAL) {
			description = description ? ` ${description},` : ``;
			toBe = Array.isArray(toBe) ? toBe.join("', '") : toBe;
			throw new SyntaxPointerError(
				`Expected literal '${toBe}'${description} but found ${getTokenTypeName(this.item.type)}`,
				this.source,
				this.item.line,
				this.item.column,
			);
		} else if (Array.isArray(toBe)) {
			if (!toBe.includes(this.item.content)) {
				description = description ? ` ${description},` : ``;
				throw new SyntaxPointerError(
					`Expected one of literals '${toBe.join("', '")}'${description} but found '${this.item.content}'`,
					this.source,
					this.item.line,
					this.item.column,
				);
			}
		} else if (this.item.content !== toBe) {
			description = description ? ` ${description},` : ``;
			throw new SyntaxPointerError(
				`Expected literal '${toBe}'${description} but found '${this.item.content}'`,
				this.source,
				this.item.line,
				this.item.column,
			);
		}
		if (advance) this.index++;
	}

	matchLiteral(toBe: string | string[]): boolean {
		if (this.item.type !== TOKEN_TYPE.LITERAL) {
			return false;
		} else if (Array.isArray(toBe)) {
			return toBe.includes(this.item.content);
		} else {
			return this.item.content === toBe;
		}
	}

	matchOpenBracket(): boolean {
		return (
			this.item.type === TOKEN_TYPE.OPEN_CURLY ||
			this.item.type === TOKEN_TYPE.OPEN_SQUARE ||
			this.item.type === TOKEN_TYPE.OPEN_PARENTHESIS
		);
	}

	matchCloseBracket(): boolean {
		return (
			this.item.type === TOKEN_TYPE.CLOSE_CURLY ||
			this.item.type === TOKEN_TYPE.CLOSE_SQUARE ||
			this.item.type === TOKEN_TYPE.CLOSE_PARENTHESIS
		);
	}

	parseLiteral() {
		const node: AstNodes[AST_NODE_TYPE.LITERAL] = {
			type: AST_NODE_TYPE.LITERAL,
			line: this.item.line,
			column: this.item.column,
			tokens: [],
		};
		while (
			this.index < this.length &&
			(this.item.type === TOKEN_TYPE.LITERAL ||
				this.item.type === TOKEN_TYPE.INLINE_SCRIPT)
		) {
			node.tokens.push(this.item);
			this.index++;
		}
		return node;
	}

	parseRestOfLine() {
		const tokens: Token[] = [];
		while (
			this.index < this.length &&
			this.item.type !== TOKEN_TYPE.LINE_BREAK
		) {
			tokens.push(this.item);
			this.index++;
		}
		return tokens;
	}

	/**
	 * Expects the parser index to have advanced past the given index. If not, throws an error.
	 */
	expectAdvance(from: number, description: string) {
		if (this.index === from) {
			throw new SyntaxPointerError(
				`Failed to advance the parser index past ${from} ${description}`,
				this.source,
				this.item.line,
				this.item.column,
			);
		}
	}

	skipSpace() {
		while (this.index < this.length && this.item.type === TOKEN_TYPE.SPACE) {
			this.index++;
		}
	}

	skipWhitespace() {
		while (
			this.index < this.length &&
			(this.item.type === TOKEN_TYPE.SPACE ||
				this.item.type === TOKEN_TYPE.LINE_BREAK)
		) {
			this.index++;
		}
	}

	// region compileTimeRepeat
	parseCompileTimeRepeat(
		ast: AstNode[],
		domainParser: (ast: AstNode[]) => void,
	) {
		const { line, column } = this.item;
		this.expectLiteral(
			KEYWORDS.COMPILE_TIME_REPEAT,
			"to start compile-time repeat",
		);
		this.skipWhitespace();

		// Expression
		this.expect(
			TOKEN_TYPE.OPEN_PARENTHESIS,
			"opening '(' for compile-time repeat condition",
		);
		this.index++;
		const expression: Token[] = [];
		while (
			this.index < this.length &&
			this.item.type !== TOKEN_TYPE.CLOSE_PARENTHESIS
		) {
			expression.push(this.item);
			this.index++;
		}
		this.expect(
			TOKEN_TYPE.CLOSE_PARENTHESIS,
			"closing ')' for compile-time repeat condition",
		);
		this.skipWhitespace();

		// Optional 'as' variable
		let varName: AstNodes[AST_NODE_TYPE.LITERAL] | undefined;
		if (this.matchLiteral(KEYWORDS.COMPILE_TIME_REPEAT_AS)) {
			this.index++;
			this.skipSpace();
			if (this.item.type !== TOKEN_TYPE.LITERAL) {
				this.expected(
					"literal variable name for compile-time repeat 'as' clause",
				);
			}
			varName = this.parseLiteral();
			this.skipWhitespace();
		}

		this.expect(
			TOKEN_TYPE.OPEN_CURLY,
			"opening '{' for compile-time repeat body",
		);
		this.skipWhitespace();

		const body: AstNode[] = [];
		domainParser(body);
		this.expect(
			TOKEN_TYPE.CLOSE_CURLY,
			"closing '}' for compile-time repeat body",
		);
		this.skipWhitespace();

		ast.push({
			type: AST_NODE_TYPE.COMPILE_TIME_REPEAT,
			line,
			column,
			expression,
			varName,
			body,
		});
	}

	// region compileTimeIf
	parseCompileTimeIf(ast: AstNode[], domainParser: (ast: AstNode[]) => void) {
		const { line, column } = this.item;
		this.expectLiteral(KEYWORDS.COMPILE_TIME_IF, "to start compile-time if");
		this.skipWhitespace();
		// Condition
		this.expect(
			TOKEN_TYPE.OPEN_PARENTHESIS,
			"opening '(' for compile-time if condition",
		);
		this.index++;
		const condition: Token[] = [];
		while (
			this.index < this.length &&
			this.item.type !== TOKEN_TYPE.CLOSE_PARENTHESIS
		) {
			condition.push(this.item);
			this.index++;
		}
		this.expect(
			TOKEN_TYPE.CLOSE_PARENTHESIS,
			"closing ')' for compile-time if condition",
		);
		this.skipWhitespace();

		this.expect(TOKEN_TYPE.OPEN_CURLY, "opening '{' for compile-time if body");
		this.skipWhitespace();

		const body: AstNode[] = [];
		try {
			domainParser(body);
			this.expect(
				TOKEN_TYPE.CLOSE_CURLY,
				"closing '}' for compile-time if body",
			);
			this.skipWhitespace();
		} catch (child) {
			if (child instanceof SyntaxPointerError) {
				throw new SyntaxPointerError(
					`Unexpected error while parsing body of compile-time IF`,
					this.source,
					line,
					column,
					{ child },
				);
			}
			throw child;
		}

		const elseExpressions: CompileTimeIfElseExpression[] = [];

		let lastIndex = -1;
		while (this.index < this.length) {
			this.expectAdvance(lastIndex, "in compile-time if else expressions");
			lastIndex = this.index;

			if (!this.matchLiteral(KEYWORDS.COMPILE_TIME_ELSE)) {
				break;
			}
			this.index++;
			// 'ELSE' and 'IF' must be on the same line for 'ELSE IF' statements.
			this.skipSpace();

			// Optional condition
			let elseIfCondition: Token[] | undefined;
			if (this.matchLiteral(KEYWORDS.COMPILE_TIME_IF)) {
				elseIfCondition = [];
				this.index++;
				this.skipWhitespace();
				this.expect(
					TOKEN_TYPE.OPEN_PARENTHESIS,
					"opening '(' for compile-time else if condition",
				);
				while (
					this.index < this.length &&
					(this.item.type as TOKEN_TYPE) !== TOKEN_TYPE.CLOSE_PARENTHESIS
				) {
					elseIfCondition.push(this.item);
					this.index++;
				}
				this.expect(
					TOKEN_TYPE.CLOSE_PARENTHESIS,
					"closing ')' for compile-time else if condition",
				);
			}

			this.skipWhitespace();

			this.expect(
				TOKEN_TYPE.OPEN_CURLY,
				"opening '{' for compile-time else body",
			);
			this.skipWhitespace();

			const elseBody: AstNode[] = [];
			domainParser(elseBody);
			this.expect(
				TOKEN_TYPE.CLOSE_CURLY,
				"closing '}' for compile-time else body",
			);
			this.skipWhitespace();
			elseExpressions.push({ condition: elseIfCondition, body: elseBody });

			if (!elseIfCondition) {
				break;
			}
		}

		ast.push({
			type: AST_NODE_TYPE.COMPILE_TIME_IF,
			line,
			column,
			condition,
			body,
			elseExpressions,
		});
	}

	// region clock
	parseClock(ast: AstNode[]) {
		const { line, column } = this.item;
		this.expectLiteral(KEYWORDS.CLOCK, "to start clock command");
		this.skipSpace();

		// Clock name
		if (this.item.type !== TOKEN_TYPE.LITERAL) {
			this.expected("literal clock name");
		}
		const name = this.parseLiteral();
		this.skipSpace();

		if (this.item.type !== TOKEN_TYPE.LITERAL) {
			this.expected("literal time value for clock command");
		}

		const time = this.parseLiteral();
		this.skipWhitespace();

		this.expect(TOKEN_TYPE.OPEN_CURLY, "start of clock command body");
		this.skipWhitespace();

		const body: AstNode[] = [];
		this.parseFunctionDomain(body);

		this.expect(TOKEN_TYPE.CLOSE_CURLY, "end of clock command");
		this.skipWhitespace();

		ast.push({ type: AST_NODE_TYPE.CLOCK, line, column, name, time, body });
	}

	// region command
	parseCommand(ast: AstNode[]) {
		const { line, column } = this.item;
		const tokens: Token[] = [];

		while (
			this.index < this.length &&
			this.item.type !== TOKEN_TYPE.LINE_BREAK
		) {
			tokens.push(this.item);
			this.index++;

			// Implicit bracket multiline handling
			if (this.matchOpenBracket()) {
				let depth = 1;
				this.index++;
				while (this.index < this.length && depth > 0) {
					if (this.matchOpenBracket()) {
						depth++;
					} else if (this.matchCloseBracket()) {
						depth--;
					}
					tokens.push(this.item);
					this.index++;
				}
			}
		}

		ast.push({ type: AST_NODE_TYPE.COMMAND, line, column, tokens });
	}

	// region block
	parseBlock(): AstNodes[AST_NODE_TYPE.BLOCK] {
		const { line, column } = this.item;
		let name: AstNodes[AST_NODE_TYPE.LITERAL] | undefined,
			args: Token[] | undefined;
		// Optional keyword
		if (this.matchLiteral(KEYWORDS.BLOCK)) {
			this.index++;
			this.skipSpace();
			// Optional name
			if (this.item.type === TOKEN_TYPE.LITERAL) {
				name = this.parseLiteral();
				this.skipSpace();
			}
		}
		this.skipWhitespace();

		this.expect(TOKEN_TYPE.OPEN_CURLY, "opening '{' for block");
		this.skipSpace();
		if ((this.item.type as TOKEN_TYPE) !== TOKEN_TYPE.LINE_BREAK) {
			args = [];
			while (
				this.index < this.length &&
				this.item.type !== TOKEN_TYPE.LINE_BREAK
			) {
				args.push(this.item);
				this.index++;
			}
		}
		this.skipWhitespace();

		const body: AstNode[] = [];
		this.parseFunctionDomain(body);

		this.expect(TOKEN_TYPE.CLOSE_CURLY, "closing '}' for block");
		this.skipWhitespace();

		return { type: AST_NODE_TYPE.BLOCK, line, column, name, body, args };
	}

	// region execute
	parseExecute(): AstNodes[
		| AST_NODE_TYPE.COMMAND
		| AST_NODE_TYPE.CONDITIONAL_BLOCK] {
		const { line, column } = this.item;
		const startIndex = this.index;
		this.expectLiteral(KEYWORDS.EXECUTE, "to start execute command");
		this.skipSpace();

		const condition: AstNode[] = [];
		while (
			this.index < this.length &&
			this.item.type !== TOKEN_TYPE.LINE_BREAK
		) {
			if (this.matchLiteral(KEYWORDS.EXECUTE_RUN)) {
				const index = this.index;
				this.index++;
				this.skipWhitespace();
				if (
					this.item.type === TOKEN_TYPE.OPEN_CURLY ||
					this.matchLiteral(KEYWORDS.BLOCK)
				) {
					return {
						type: AST_NODE_TYPE.CONDITIONAL_BLOCK,
						line,
						column,
						condition,
						block: this.parseBlock(),
					};
				}
				this.index = index; // rollback
			} else if (
				this.matchLiteral([KEYWORDS.EXECUTE_IF, KEYWORDS.EXECUTE_UNLESS])
			) {
				const index = this.index;
				this.index++;
				this.skipSpace();
				if (this.matchLiteral("function")) {
					this.index++;
					this.skipWhitespace();
					condition.push({
						type: AST_NODE_TYPE.EXECUTE_IF_UNLESS_FUNCTION,
						line: this.item.line,
						column: this.item.column,
						mode: (this.item as Tokens[TOKEN_TYPE.LITERAL]).content as
							| "if"
							| "unless",
						block: this.parseBlock(),
					});
					continue;
				}
				this.index = index; // rollback
			}

			condition.push({
				type: AST_NODE_TYPE.LITERAL,
				line: this.item.line,
				column: this.item.column,
				tokens: [
					{
						type: TOKEN_TYPE.LITERAL,
						content: stringifyToken(this.item),
						line: this.item.line,
						column: this.item.column,
					},
				],
			});
			this.index++;
		}

		return {
			type: AST_NODE_TYPE.COMMAND,
			line,
			column,
			tokens: this.slice(startIndex, this.index),
		};
	}

	// region executeRunChain
	parseExecuteRunChain(ast: AstNode[]) {
		const { line, column } = this.item;
		const blocks: AstNodes[AST_NODE_TYPE.CONDITIONAL_BLOCK][] = [];

		let lastIndex = -1;
		while (this.index < this.length) {
			this.expectAdvance(lastIndex, "in execute run chain");
			lastIndex = this.index;

			const executeNode = this.parseExecute();
			if (executeNode.type === AST_NODE_TYPE.CONDITIONAL_BLOCK) {
				blocks.push(executeNode);
			} else {
				ast.push(executeNode);
				this.skipWhitespace();
				return;
			}

			if (this.matchLiteral(KEYWORDS.EXECUTE_ELSE)) {
				this.index++;
				this.skipSpace();
				if (this.matchLiteral(KEYWORDS.EXECUTE_RUN)) {
					this.index++;
					this.skipWhitespace();
					const elseBlock = this.parseBlock();
					blocks.push({
						type: AST_NODE_TYPE.CONDITIONAL_BLOCK,
						line: elseBlock.line,
						column: elseBlock.column,
						block: elseBlock,
					});
					break;
				} else if (this.matchLiteral(KEYWORDS.EXECUTE)) {
					continue;
				}
				this.expected("'run' or 'execute' after 'else' in execute run chain");
			}

			break;
		}

		ast.push({
			type: AST_NODE_TYPE.EXECUTE_RUN_CHAIN,
			line,
			column,
			blocks,
		});
	}

	// region functionCall
	parseFunctionCall(ast: AstNode[]) {
		const { line, column } = this.item;
		this.expectLiteral(KEYWORDS.FUNCTION, "to start function call");
		this.skipSpace();
		const path = this.parseLiteral();
		if (path.tokens.length === 0) {
			this.expected("function path");
		}

		let mode: AstNodes[AST_NODE_TYPE.FUNCTION_CALL]["mode"] = "absolute";
		if (path.tokens[0].type === TOKEN_TYPE.LITERAL) {
			const firstToken = path.tokens[0];
			if (firstToken.content.indexOf("./") === 0) {
				mode = "relative";
				firstToken.content = firstToken.content.substring(2);
			} else if (firstToken.content.indexOf("../") === 0) {
				mode = "relative";
				firstToken.content = firstToken.content.substring(3);
			} else if (firstToken.content.indexOf("^") === 0) {
				mode = "hiarchical";
				firstToken.content = firstToken.content.substring(1);
			} else if (firstToken.content.indexOf("*") === 0) {
				mode = "root";
				firstToken.content = firstToken.content.substring(1);
			}
		}
		this.skipSpace();

		let args: Token[] | undefined;
		if (this.item.type !== TOKEN_TYPE.LINE_BREAK) {
			args = this.parseRestOfLine();
		}
		this.skipWhitespace();

		ast.push({
			type: AST_NODE_TYPE.FUNCTION_CALL,
			line,
			column,
			path,
			mode,
			args,
		});
	}

	// region schedule
	parseSchedule(ast: AstNode[]) {
		const { line, column } = this.item;
		this.expectLiteral(KEYWORDS.SCHEDULE, "to start schedule command");
		this.skipSpace();

		if (this.matchLiteral("function")) {
			this.parseScheduleCall(ast, line, column);
			return;
		} else {
			this.parseScheduleBlock(ast, line, column);
			return;
		}
	}

	parseScheduleCall(ast: AstNode[], line: number, column: number) {
		this.expectLiteral("function", "to start schedule function call");
		this.skipSpace();
		const delay = this.parseLiteral();
		if (delay.tokens.length === 0) {
			this.expected("function name for schedule command");
		}
		this.skipSpace();

		const name = this.parseLiteral();
		if (name.tokens.length === 0) {
			this.expected("function name for schedule command");
		}
		this.skipSpace();

		let mode: "append" | "replace" | undefined;
		if (
			this.matchLiteral(KEYWORDS.SCHEDULE_REPLACE) ||
			this.matchLiteral(KEYWORDS.SCHEDULE_APPEND)
		) {
			mode = (this.item as any).content;
			this.index++;
		}
		this.skipWhitespace();

		ast.push({
			type: AST_NODE_TYPE.SCHEDULE_CALL,
			line,
			column,
			delay,
			name,
			mode,
		});
	}

	parseScheduleBlock(ast: AstNode[], line: number, column: number) {
		const delay = this.parseLiteral();
		if (delay.tokens.length === 0) {
			this.expected("delay for schedule command");
		}
		this.skipWhitespace();

		let mode: "append" | "replace" | undefined;
		if (
			this.matchLiteral(KEYWORDS.SCHEDULE_REPLACE) ||
			this.matchLiteral(KEYWORDS.SCHEDULE_APPEND)
		) {
			mode = (this.item as any).content;
			this.index++;
			this.skipWhitespace();
		}

		const block = this.parseBlock();
		if (block.args) {
			throw new SyntaxPointerError(
				`Schedule block cannot have arguments`,
				this.source,
				block.line,
				block.column,
			);
		}

		ast.push({
			type: AST_NODE_TYPE.SCHEDULE_BLOCK,
			line,
			column,
			delay,
			mode,
			block,
		});
	}

	// region functionDomain
	parseFunctionDomain(ast: AstNode[]) {
		let lastIndex = -1;
		while (this.index < this.length) {
			this.expectAdvance(lastIndex, "in function body");
			lastIndex = this.index;
			switch (this.item.type) {
				case TOKEN_TYPE.LINE_BREAK:
					this.index++;
					break;

				case TOKEN_TYPE.COMMENT:
					this.index++;
					break;

				case TOKEN_TYPE.MULTI_LINE_COMMENT:
					this.index++;
					break;

				case TOKEN_TYPE.INLINE_SCRIPT:
					ast.push({
						type: AST_NODE_TYPE.INLINE_SCRIPT,
						line: this.item.line,
						column: this.item.column,
						script: this.item.script,
					});
					this.index++;
					break;

				case TOKEN_TYPE.SCRIPT_BLOCK:
					ast.push({
						type: AST_NODE_TYPE.SCRIPT_BLOCK,
						line: this.item.line,
						column: this.item.column,
						script: this.item.script,
					});
					this.index++;
					break;

				case TOKEN_TYPE.OPEN_CURLY:
					// Anonymous block
					ast.push(this.parseBlock());
					break;

				case TOKEN_TYPE.CLOSE_CURLY:
					return;

				case TOKEN_TYPE.LITERAL:
					switch (this.item.content) {
						case KEYWORDS.FUNCTION:
							this.parseFunctionCall(ast);
							break;

						case KEYWORDS.BLOCK:
							ast.push(this.parseBlock());
							break;

						case KEYWORDS.COMPILE_TIME_IF:
							this.parseCompileTimeIf(ast, this.parseFunctionDomain.bind(this));
							break;

						case KEYWORDS.COMPILE_TIME_REPEAT:
							this.parseCompileTimeRepeat(
								ast,
								this.parseFunctionDomain.bind(this),
							);
							break;

						case KEYWORDS.EXECUTE:
							this.parseExecuteRunChain(ast);
							break;

						case KEYWORDS.SCHEDULE:
							this.parseSchedule(ast);
							break;

						default:
							this.parseCommand(ast);
							break;
					}
					break;

				default:
					this.unexpected("in function body");
			}
		}
	}

	// region functionDefinition
	parseFunctionDefinition(ast: AstNode[]) {
		const { line, column } = this.item;
		this.expectLiteral(KEYWORDS.FUNCTION, "to start function definition");
		this.skipWhitespace();
		// Function name
		if (this.item.type !== TOKEN_TYPE.LITERAL) {
			this.expected("literal function name");
		}

		const name = this.parseLiteral();
		this.skipWhitespace();

		// Function tag (optional)
		let tag: AstNodes[AST_NODE_TYPE.LITERAL] | undefined;
		if (this.item.type === TOKEN_TYPE.LITERAL) {
			tag = this.parseLiteral();
			this.skipWhitespace();
		}

		this.expect(TOKEN_TYPE.OPEN_CURLY, "opening '{' for function body");
		this.skipWhitespace();

		const body: AstNode[] = [];
		this.parseFunctionDomain(body);

		this.expect(TOKEN_TYPE.CLOSE_CURLY, "closing '}' for function body");
		this.skipWhitespace();

		ast.push({
			type: AST_NODE_TYPE.FUNCTION_DEF,
			line,
			column,
			name,
			tag,
			body,
		});
	}

	// region import
	parseImport(ast: AstNode[]) {
		const { line, column } = this.item;
		this.expectLiteral(KEYWORDS.IMPORT, "to start import statement");
		this.skipSpace();
		const path = this.parseLiteral();
		if (path.tokens.length === 0) {
			this.expected("import path");
		}
		this.skipWhitespace();
		ast.push({ type: AST_NODE_TYPE.IMPORT, line, column, path });
	}

	// region jsonBody
	parseJsonBody(
		openingBracket: TOKEN_TYPE,
		closingBracket: TOKEN_TYPE,
		ast: AstNode[],
	) {
		let literal: AstNodes[AST_NODE_TYPE.LITERAL] = {
			type: AST_NODE_TYPE.LITERAL,
			line: this.item.line,
			column: this.item.column,
			tokens: [],
		};

		let bracketDepth = 1;
		let lastIndex = -1;
		while (this.index < this.length) {
			this.expectAdvance(lastIndex, "in json file body");
			lastIndex = this.index;
			switch (this.item.type as TOKEN_TYPE) {
				case openingBracket:
					bracketDepth++;
					literal.tokens.push(this.item);
					this.index++;
					break;

				case closingBracket:
					bracketDepth--;
					if (bracketDepth <= 0) {
						if (literal.tokens.length > 0) {
							ast.push(literal);
						}
						return;
					}
					literal.tokens.push(this.item);
					this.index++;
					break;

				case TOKEN_TYPE.LINE_CONTINUATION:
					this.index++;
					this.skipWhitespace();
					break;

				case TOKEN_TYPE.LITERAL:
					if (this.matchLiteral([KEYWORDS.COMPILE_TIME_IF])) {
						if (literal.tokens.length > 0) {
							ast.push({ ...literal });
							literal.tokens = [];
						}
						this.parseCompileTimeIf(
							ast,
							this.parseJsonBody.bind(
								this,
								TOKEN_TYPE.OPEN_CURLY,
								TOKEN_TYPE.CLOSE_CURLY,
							),
						);
						literal.line = this.item.line;
						literal.column = this.item.column;
						break;
					}
					if (this.matchLiteral([KEYWORDS.COMPILE_TIME_REPEAT])) {
						if (literal.tokens.length > 0) {
							ast.push({ ...literal });
							literal.tokens = [];
						}
						this.parseCompileTimeRepeat(
							ast,
							this.parseJsonBody.bind(
								this,
								TOKEN_TYPE.OPEN_CURLY,
								TOKEN_TYPE.CLOSE_CURLY,
							),
						);
						literal.line = this.item.line;
						literal.column = this.item.column;
						break;
					}

					literal.tokens.push(this.item);
					this.index++;
					break;

				default:
					literal.tokens.push(this.item);
					this.index++;
					break;
			}
		}
		this.unexpected("in json file body");
	}

	// region jsonFile
	parseJsonFile(ast: AstNode[]) {
		const { line, column } = this.item;
		this.expectLiteral(KEYWORDS.JSON, "to start json file definition");
		this.skipSpace();
		const path = this.parseLiteral();
		if (path.tokens.length === 0) {
			this.expected("json file path");
		}
		this.skipSpace();
		const name = this.parseLiteral();
		if (name.tokens.length === 0) {
			this.expected("json file name");
		}
		this.skipWhitespace();

		let openingBracket: TOKEN_TYPE, closingBracket: TOKEN_TYPE;
		if (this.item.type === TOKEN_TYPE.OPEN_CURLY) {
			openingBracket = TOKEN_TYPE.OPEN_CURLY;
			closingBracket = TOKEN_TYPE.CLOSE_CURLY;
		} else if (this.item.type === TOKEN_TYPE.OPEN_SQUARE) {
			openingBracket = TOKEN_TYPE.OPEN_SQUARE;
			closingBracket = TOKEN_TYPE.CLOSE_SQUARE;
		} else {
			this.expected("opening '{' or '[' for json file body");
		}
		this.index++; // Skip opening '{' or '['

		const body: AstNode[] = [];
		this.parseJsonBody(openingBracket, closingBracket, body);

		// Expect closing bracket
		this.expect(
			closingBracket,
			`closing ${stringifyToken({ type: closingBracket } as any)} for json file body`,
		);
		this.skipWhitespace();

		ast.push({ type: AST_NODE_TYPE.JSON_FILE, line, column, path, name, body });
	}

	// region folderDefinition
	parseFolderDefinition(ast: AstNode[]) {
		const { line, column } = this.item;
		this.expectLiteral(
			[KEYWORDS.DIR, KEYWORDS.FOLDER] as const,
			"to start folder definition",
		);
		this.index++;
		this.skipWhitespace();

		// Folder name
		if (this.item.type !== TOKEN_TYPE.LITERAL) {
			this.expected("literal folder name");
		}
		const name = this.parseLiteral();
		this.skipWhitespace();

		this.expect(TOKEN_TYPE.OPEN_CURLY, "opening '{' for folder body");
		this.skipWhitespace();

		const body: AstNode[] = [];
		this.parseFolderDomain(body);

		this.expect(TOKEN_TYPE.CLOSE_CURLY, "closing '}' for folder body");
		this.skipWhitespace();
		ast.push({ type: AST_NODE_TYPE.FOLDER_DEF, line, column, name, body });
	}

	// region folderDomain
	parseFolderDomain(ast: AstNode[], isTopLevel = false) {
		let lastIndex = -1;
		while (this.index < this.length) {
			this.expectAdvance(
				lastIndex,
				`in ${isTopLevel ? "top-level" : "folder"} domain`,
			);
			lastIndex = this.index;
			switch (this.item.type) {
				case TOKEN_TYPE.LINE_BREAK:
					this.index++;
					break;

				case TOKEN_TYPE.COMMENT:
					this.index++;
					break;

				case TOKEN_TYPE.MULTI_LINE_COMMENT:
					this.index++;
					break;

				case TOKEN_TYPE.SCRIPT_BLOCK:
					ast.push({
						type: AST_NODE_TYPE.SCRIPT_BLOCK,
						line: this.item.line,
						column: this.item.column,
						script: this.item.script,
					});
					this.index++;
					break;

				case TOKEN_TYPE.CLOSE_CURLY:
					if (isTopLevel) {
						this.unexpected("in top-level domain");
					}
					return;

				case TOKEN_TYPE.LITERAL:
					switch (this.item.content) {
						case KEYWORDS.DIR:
							this.parseFolderDefinition(ast);
							break;

						case KEYWORDS.FOLDER:
							this.parseFolderDefinition(ast);
							break;

						case KEYWORDS.FUNCTION:
							this.parseFunctionDefinition(ast);
							break;

						case KEYWORDS.CLOCK:
							this.parseClock(ast);
							break;

						case KEYWORDS.COMPILE_TIME_IF:
							this.parseCompileTimeIf(ast, this.parseFolderDomain.bind(this));
							break;

						case KEYWORDS.COMPILE_TIME_REPEAT:
							this.parseCompileTimeRepeat(
								ast,
								this.parseFolderDomain.bind(this),
							);
							break;

						case KEYWORDS.IMPORT:
							this.parseImport(ast);
							break;

						case KEYWORDS.JSON:
							this.parseJsonFile(ast);
							break;

						default:
							this.unexpected(
								`in ${isTopLevel ? "top-level" : "folder"} domain`,
							);
					}
					break;

				default:
					this.unexpected(`in ${isTopLevel ? "top-level" : "folder"} domain`);
			}
		}
	}

	// region parseMcbFile
	parseMcbFile(): AstNode[] {
		const ast: AstNode[] = [];
		try {
			this.parseFolderDomain(ast, true);
		} catch (e) {
			writeFileSync(
				"mcb-parser-error-context.json",
				prettier.format(JSON.stringify(ast), {
					parser: "json",
					printWidth: 120,
				}),
			);
			throw e;
		}
		return ast;
	}
}

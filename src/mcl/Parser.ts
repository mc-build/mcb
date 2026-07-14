import { Token, TokenIds, PosInfo } from "./Tokenizer";
import { ArrayInput } from "./ArrayInput";
import { ParserError } from "./error/ParserError";
import { StringUtils } from "../strutils/StringUtils";
import { AstNode, JsonTagType } from "./AstNode";

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
	return { type: "TemplateDef", pos, name, body };
}

function json(reader: TokenInput): AstNode {
	const start = reader.peek().pos;
	let depth = 0;
	let result = "";
	do {
		if (!reader.hasNext()) {
			throw new ParserError("Unexpected end of file!", reader.last()?.pos ?? null);
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
			name,
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
			name: payload,
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
		name,
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

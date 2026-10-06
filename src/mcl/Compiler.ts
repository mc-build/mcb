import path from "node:path";
import Module from "node:module";
import chalk from "chalk";

import {
	AstNode,
	AstNodeUtils,
	CompileTimeIfElseExpressions,
	JsonTagType,
} from "./AstNode";
import { Config, IoLike, UserConfig } from "./Config";
import { Globals } from "./Globals";
import { Parser } from "./Parser";
import { Token, TokenIds, PosInfo } from "./Tokenizer";
import { Tokenizer } from "./TokenizerImpl";
import { injectExpressions, advancePos } from "./InlineExpressionUtils";
import { CompilerError, ErrorUtil } from "./error/CompilerError";
import { McbError } from "./error/McbError";
import { StringUtils } from "../strutils/StringUtils";
import { TagManager } from "./TagManager";
import { TemplateArgument } from "./args/TemplateArgument";
import * as McMath from "./McMath";
import { BoundBlock } from "./args/BlockTemplateArgument";
import { JsonParser, JsonSyntaxError } from "./JsonParser";

let __require: (file: string) => any;
const selfRequire = (file: string): any => {
	if (__require === undefined) __require = Module.createRequire(__filename);
	return __require(file);
}

type RawNode = Extract<AstNode, { type: "Raw" }>;

/** Renders the line of generated JSON containing `offset`, with a pointer under it. */
function renderJsonPointer(text: string, offset: number): string {
	const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
	const lineEnd = text.indexOf("\n", offset);
	const line = text.substring(lineStart, lineEnd === -1 ? text.length : lineEnd);
	const label = String(text.substring(0, lineStart).split("\n").length);
	const gutter = " ".repeat(label.length);
	const pointerColumn = line
		.substring(0, offset - lineStart)
		.replace(/\t/g, "    ").length;
	return [
		"  Generated JSON:",
		`    ${chalk.dim(`${label} |`)} ${line.replace(/\t/g, "    ")}`,
		`    ${chalk.dim(`${gutter} |`)} ${" ".repeat(pointerColumn)}${chalk.redBright("↑")}`,
	].join("\n");
}

function describeScriptValue(value: unknown): string {
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	if (Array.isArray(value)) return "an array";
	if (typeof value === "string") {
		const truncated =
			value.length > 30 ? `${value.slice(0, 30)}...` : value;
		return `a string (${JSON.stringify(truncated)})`;
	}
	if (typeof value === "object") {
		const ctorName = value.constructor?.name;
		return ctorName && ctorName !== "Object"
			? `an instance of ${ctorName}`
			: "a plain object";
	}
	return `a ${typeof value}`;
}

/**
 * Determines how a comment node should be emitted into a function body.
 * Returns the text to emit, or null if the comment should be discarded.
 * - "### ..." multiline comment content is emitted unchanged.
 * - "\# ..." escaped comments are emitted with the leading backslash removed.
 * - unescaped "# ..." comments are no longer emitted.
 */
function resolveEmittedComment(value: string): string | null {
	if (StringUtils.startsWithConstExpr(value, "###")) {
		return value;
	}
	if (StringUtils.startsWithConstExpr(value, "\\#")) {
		return value.substring(1);
	}
	return null;
}

class UidTracker {
	private uid = 0;

	get(): number {
		return this.uid++;
	}
}

export type VariableRecord = Map<string, unknown>;

export class VariableMap {
	private cache: VariableRecord | null = null;
	static globals: VariableMap;

	constructor(
		private parent: VariableMap | null,
		private variables: VariableRecord = new Map(),
	) {}

	static fromObject(obj: Record<string, unknown>): VariableMap {
		const result = new Map<string, unknown>();
		for (const key of Object.keys(obj)) {
			result.set(key, (obj as any)[key]);
		}
		return new VariableMap(null, result);
	}

	get(): VariableRecord {
		if (this.cache) {
			return new Map(this.cache);
		}
		const result = this.parent ? this.parent.get() : new Map<string, unknown>();
		for (const [key, value] of this.variables.entries()) {
			result.set(key, value);
		}
		this.cache = result;
		return new Map(result);
	}

	fork(vars?: VariableRecord | null): VariableMap {
		const variables = vars ?? new Map<string, unknown>();
		return new VariableMap(this, variables);
	}
}
VariableMap.globals = new VariableMap(null, Globals.map);


export type BaseNameInfo = {
	namespace: string;
	path: string[];
};

export type CompilerContext = {
	append: (command: string) => void;
	namespace: string;
	path: string[];
	uidIndex: UidTracker;
	variables: VariableMap;
	replacements: VariableMap;
	stack: PosInfo[];
	isTemplate: boolean;
	isMacro: boolean;
	templates: Map<string, McTemplate>;
	requireTemplateKeyword: boolean;
	compiler: Compiler;
	globalVariables: VariableMap;
	functions: (string | null)[];
	currentFunction: string[] | null;
	baseNamespaceInfo: BaseNameInfo;
};

type ImportFileType =
	| { kind: "McFile"; file: McFile }
	| { kind: "JsFile"; value: unknown };

type TemplateArgumentMap = Map<TemplateArgument[], AstNode[]>;

type ScriptEmit = ((command: string) => void) & {
	mcb(code: string | AstNode):void;
	mcb(code:BoundBlock,vars?:Map<string,any>):void;
	block?: (commands: string[], data?: string) => string;
};

/**
 * Combines a template's own (defining-file) templates with whatever templates
 * were visible in the calling context, so a template's body - including code
 * emitted dynamically via `emit.mcb()` - can call templates the caller has in
 * scope (e.g. one imported into the calling file but not the template's own
 * file). Entries from `own` take precedence on name conflicts.
 */
function mergeTemplates(
	caller: Map<string, McTemplate>,
	own: Map<string, McTemplate>,
): Map<string, McTemplate> {
	if (caller.size === 0) {
		return own;
	}
	return new Map([...caller, ...own]);
}

class McTemplate {
	private overloads: TemplateArgumentMap = new Map();
	private tldOverloads: TemplateArgumentMap = new Map();
	private loadBlock: AstNode[] | null = null;
	private tickBlock: AstNode[] | null = null;
	private hasBeenUsed = false;
	private jsValueCache: Map<number, unknown> = new Map();

	constructor(
		private name: string,
		private body: AstNode[],
		private file: McFile,
	) {
		this.parse(body);
	}

	private compileArgs(args: string, pos: PosInfo): TemplateArgument[] {
		const result: TemplateArgument[] = [];
		const sections = args.split(" ");
		let offset = 0;
		for (const section of sections) {
			if (section === "") {
				offset++;
				continue;
			}
			const argumentPos: PosInfo = {
				file: pos.file,
				line: pos.line,
				col: pos.col + offset,
			};
			result.push(TemplateArgument.parse(section, argumentPos));
			offset += section.length;
		}
		return result;
	}

	private parse(nodes: AstNode[]): void {
		for (const node of nodes) {
			switch (node.type) {
				case "TemplateOverload":
					(node.isTld ? this.tldOverloads : this.overloads).set(
						this.compileArgs(node.args, node.pos),
						node.body,
					);
					break;
				case "LoadBlock":
					if (this.loadBlock) {
						throw CompilerError.createInternal(
							"Templates can only have one top-level load block",
							node.pos,
							{ stack: [] },
						);
					}
					this.loadBlock = node.body;
					break;
				case "TickBlock":
					if (this.tickBlock) {
						throw CompilerError.createInternal(
							"Templates can only have one top-level tick block",
							node.pos,
							{ stack: [] },
						);
					}
					this.tickBlock = node.body;
					break;
				case "Comment":
					break;
				default:
					throw CompilerError.createInternal(
						"Unexpected node type: " + JSON.stringify(node),
						AstNodeUtils.getPos(node),
						{ stack: [] },
					);
			}
		}
	}

	private static ltrim(value: string): string {
		return value.replace(/^\s+/, "");
	}

	private static stringifyInlineResult(value: unknown): string {
		if (value === null) {
			return "null";
		}
		if (value === undefined) {
			return "undefined";
		}
		if (typeof value === "string") {
			return value;
		}
		if (
			typeof value === "number" ||
			typeof value === "bigint" ||
			typeof value === "boolean"
		) {
			return String(value);
		}
		try {
			const json = JSON.stringify(value);
			if (json !== undefined) {
				return json;
			}
		} catch {
			// ignore and fall back to default string conversion
		}
		return String(value);
	}

	private buildInjectedDefs(): AstNode[] {
		const defs: AstNode[] = [];
		if (this.loadBlock && this.loadBlock.length > 0) {
			const pos = AstNodeUtils.getPos(this.loadBlock[0]);
			defs.push({
				type: "FunctionDef",
				pos,
				name: "load",
				body: this.loadBlock,
				appendTo: "minecraft:load",
			});
		}
		if (this.tickBlock && this.tickBlock.length > 0) {
			const pos = AstNodeUtils.getPos(this.tickBlock[0]);
			defs.push({
				type: "FunctionDef",
				pos,
				name: "tick",
				body: this.tickBlock,
				appendTo: "minecraft:tick",
			});
		}
		return defs;
	}

	private inject(context: CompilerContext, into: McFile): void {
		if (this.hasBeenUsed) {
			return;
		}
		const defs = this.buildInjectedDefs();
		if (defs.length === 0) {
			this.hasBeenUsed = true;
			return;
		}
		const pos = AstNodeUtils.getPos(defs[0]);
		const info = context.compiler.getInitialPathInfo(this.file.name);
		const templateContext: CompilerContext = {
			append: () => {
				throw CompilerError.create(
					"tried to append to a Void context (template virtual context)",
					pos,
					context,
				);
			},
			namespace: info.namespace,
			path: info.path,
			uidIndex: context.uidIndex,
			variables: new VariableMap(context.globalVariables),
			replacements: new VariableMap(null),
			stack: context.stack,
			isTemplate: false,
			isMacro: context.isMacro,
			templates: mergeTemplates(context.templates, this.file.templates),
			requireTemplateKeyword: true,
			compiler: context.compiler,
			globalVariables: context.globalVariables,
			functions: context.functions,
			currentFunction: context.currentFunction,
			baseNamespaceInfo: context.baseNamespaceInfo,
		};
		const directory: AstNode = {
			type: "Directory",
			pos,
			name: this.name,
			body: defs,
		};
		into.embed(templateContext, pos, new Map(), [directory], true);
		this.hasBeenUsed = true;
	}

	private injectTransform(context: CompilerContext, into: McFile): AstNode {
		if (this.hasBeenUsed) {
			return { type: "Void" };
		}
		const defs = this.buildInjectedDefs();
		if (defs.length === 0) {
			this.hasBeenUsed = true;
			return { type: "Void" };
		}
		const pos = AstNodeUtils.getPos(defs[0]);
		const info = context.compiler.getInitialPathInfo(this.file.name);
		const templateContext: CompilerContext = {
			append: () => {
				throw CompilerError.create(
					"tried to append to a Void context (template virtual context)",
					pos,
					context,
				);
			},
			namespace: info.namespace,
			path: info.path,
			uidIndex: context.uidIndex,
			variables: new VariableMap(context.globalVariables),
			replacements: new VariableMap(null),
			stack: context.stack,
			isTemplate: false,
			isMacro: context.isMacro,
			templates: mergeTemplates(context.templates, this.file.templates),
			requireTemplateKeyword: true,
			compiler: context.compiler,
			globalVariables: context.globalVariables,
			functions: context.functions,
			currentFunction: context.currentFunction,
			baseNamespaceInfo: context.baseNamespaceInfo,
		};
		const directory: AstNode = {
			type: "Directory",
			pos,
			name: this.name,
			body: defs,
		};
		into.embedTransform(templateContext, pos, new Map(), [directory], true);
		this.hasBeenUsed = true;
		return { type: "Void" };
	}

	process(
		file: McFile,
		context: CompilerContext,
		pos: PosInfo,
		value: string,
		extras: AstNode[] | null,
		isMacro: boolean,
		useTld = false,
	): void {
		let argString = value.substring(this.name.length);
		argString = McTemplate.ltrim(argString);
		const argStringPos = advancePos(
			pos,
			value.substring(0, value.length - argString.length),
		);
		const extrasPos = (extras ?? []).map((e) => AstNodeUtils.getPos(e));
		this.jsValueCache.clear();
		TemplateArgument.resetJsCache(this.jsValueCache);

		const overloads = useTld ? this.tldOverloads : this.overloads;
		for (const [types, overloadBody] of overloads.entries()) {
			const args = new Map<string, unknown>();
			let successCount = 0;
			let pidx = 0;
			const argList: unknown[] = [argString, ...(extras ?? [])].map(_=>typeof _ === "string" ? _ : _.type === "Raw" ? _.value : _);
			const argPosList: PosInfo[] = [argStringPos, ...extrasPos];
			let lastEntryWasBlock = false;
			let jsCacheIdx = 0;

			for (const arg of types) {
				while (pidx < argList.length && argList[pidx] === "") {
					pidx++;
				}
				if (pidx >= argList.length) {
					break;
				}

				if (arg.expectBlock) {
					const candidate = argList[pidx];
					if (!candidate || typeof candidate === "string") {
						break;
					}
					const parsed = arg.parseValueBlock(
						candidate as AstNode,
						pos,
						context,
					);
					if (!parsed.success) {
						break;
					}
					if (arg.name) {
						args.set(arg.name, parsed.value);
					}
					argList[pidx] = parsed.raw ?? "";
					successCount++;
					pidx++;
					lastEntryWasBlock = true;
					continue;
				}

				const candidate = argList[pidx];
				if (typeof candidate !== "string") {
					break;
				}
				const original = candidate;
				let working = candidate;
				const currentArgPos = argPosList[pidx];
				let jsBlockRaw: string | null = null;
				if (working.startsWith("<%") && !arg.expectJsValue) {
					const end = working.indexOf("%>");
					if (end === -1) {
						throw CompilerError.create(
							"Unexpected end of inline script block",
							currentArgPos,
							context,
						);
					}
					const script = working.substring(2, end);
					jsBlockRaw = script;
					let valueResult: unknown;
					if (this.jsValueCache.has(jsCacheIdx)) {
						valueResult = this.jsValueCache.get(jsCacheIdx);
					} else {
						valueResult = McFile.invokeExpressionInline(
							script,
							context,
							currentArgPos,
						);
						this.jsValueCache.set(jsCacheIdx, valueResult);
					}
					working = McTemplate.stringifyInlineResult(valueResult);
					jsCacheIdx++;
				} else if (arg.expectJsValue) {
					TemplateArgument.jsCacheIdx = jsCacheIdx;
					jsCacheIdx++;
				}

				const parsed = arg.parseValue(working, currentArgPos, context);
				if (!parsed.success) {
					break;
				}
				if (arg.name) {
					args.set(arg.name, parsed.value);
				}
				const rawValue =
					typeof parsed.raw === "string"
						? parsed.raw
						: parsed.raw != null
							? String(parsed.raw)
							: "";
				if (jsBlockRaw !== null) {
					const remainder = original.substring(jsBlockRaw.length + 4);
					argList[pidx] = McTemplate.ltrim(remainder);
				} else {
					const remainder = original.substring(rawValue.length);
					argList[pidx] = McTemplate.ltrim(remainder);
				}
				argPosList[pidx] = advancePos(
					currentArgPos,
					original.substring(
						0,
						original.length - (argList[pidx] as string).length,
					),
				);
				successCount++;
				lastEntryWasBlock = false;
			}

			while (pidx < argList.length && argList[pidx] === "") {
				pidx++;
			}

			const lastEntry = pidx > 0 ? argList[pidx - 1] : "";
			if (
				successCount !== types.length ||
				pidx !== argList.length ||
				(typeof lastEntry === "string" &&
					lastEntry !== "" &&
					!lastEntryWasBlock)
			) {
				continue;
			}

			this.inject(context, file);
			const newContext: CompilerContext = {
				append: context.append,
				namespace: context.namespace,
				path: context.path,
				uidIndex: context.uidIndex,
				variables: context.variables,
				replacements: context.replacements,
				stack: [pos, ...context.stack],
				isTemplate: false,
				isMacro,
				templates: mergeTemplates(context.templates, this.file.templates),
				requireTemplateKeyword: true,
				compiler: context.compiler,
				globalVariables: context.globalVariables,
				functions: context.functions,
				currentFunction: context.currentFunction,
				baseNamespaceInfo: context.baseNamespaceInfo,
			};
			file.embed(newContext, pos, args, overloadBody, useTld);
			return;
		}

		throw CompilerError.create(
			`Failed to find matching ${useTld ? "top-level (tld with) " : ""}template overload for: ${value}`,
			pos,
			context,
		);
	}

	transform(
		file: McFile,
		context: CompilerContext,
		pos: PosInfo,
		value: string,
		extras: AstNode[] | null,
		isMacro: boolean,
		useTld = false,
	): AstNode {
		let argString = value.substring(this.name.length);
		argString = McTemplate.ltrim(argString);
		const argStringPos = advancePos(
			pos,
			value.substring(0, value.length - argString.length),
		);
		const extrasPos = (extras ?? []).map((e) => AstNodeUtils.getPos(e));
		this.jsValueCache.clear();
		TemplateArgument.resetJsCache(this.jsValueCache);

		const overloads = useTld ? this.tldOverloads : this.overloads;
		for (const [types, overloadBody] of overloads.entries()) {
			const args = new Map<string, unknown>();
			let successCount = 0;
			let pidx = 0;
			const argList: unknown[] = [argString, ...(extras ?? [])];
			const argPosList: PosInfo[] = [argStringPos, ...extrasPos];
			let lastEntryWasBlock = false;
			let jsCacheIdx = 0;

			for (const arg of types) {
				while (pidx < argList.length && argList[pidx] === "") {
					pidx++;
				}
				if (pidx >= argList.length) {
					break;
				}

				if (arg.expectBlock) {
					const candidate = argList[pidx];
					if (!candidate || typeof candidate === "string") {
						break;
					}
					const parsed = arg.parseValueBlock(
						candidate as AstNode,
						pos,
						context,
					);
					if (!parsed.success) {
						break;
					}
					if (arg.name) {
						args.set(arg.name, parsed.value);
					}
					argList[pidx] = parsed.raw ?? "";
					successCount++;
					pidx++;
					lastEntryWasBlock = true;
					continue;
				}

				const candidate = argList[pidx];
				if (typeof candidate !== "string") {
					break;
				}
				const original = candidate;
				let working = candidate;
				const currentArgPos = argPosList[pidx];
				let jsBlockRaw: string | null = null;
				if (working.startsWith("<%") && !arg.expectJsValue) {
					const end = working.indexOf("%>");
					if (end === -1) {
						throw CompilerError.create(
							"Unexpected end of inline script block",
							currentArgPos,
							context,
						);
					}
					const script = working.substring(2, end);
					jsBlockRaw = script;
					let valueResult: unknown;
					if (this.jsValueCache.has(jsCacheIdx)) {
						valueResult = this.jsValueCache.get(jsCacheIdx);
					} else {
						valueResult = McFile.invokeExpressionInline(
							script,
							context,
							currentArgPos,
						);
						this.jsValueCache.set(jsCacheIdx, valueResult);
					}
					working = McTemplate.stringifyInlineResult(valueResult);
					jsCacheIdx++;
				} else if (arg.expectJsValue) {
					TemplateArgument.jsCacheIdx = jsCacheIdx;
					jsCacheIdx++;
				}

				const parsed = arg.parseValue(working, currentArgPos, context);
				if (!parsed.success) {
					break;
				}
				if (arg.name) {
					args.set(arg.name, parsed.value);
				}
				const rawValue =
					typeof parsed.raw === "string"
						? parsed.raw
						: parsed.raw != null
							? String(parsed.raw)
							: "";
				if (jsBlockRaw !== null) {
					const remainder = original.substring(jsBlockRaw.length + 4);
					argList[pidx] = McTemplate.ltrim(remainder);
				} else {
					const remainder = original.substring(rawValue.length);
					argList[pidx] = McTemplate.ltrim(remainder);
				}
				argPosList[pidx] = advancePos(
					currentArgPos,
					original.substring(
						0,
						original.length - (argList[pidx] as string).length,
					),
				);
				successCount++;
				lastEntryWasBlock = false;
			}

			while (pidx < argList.length && argList[pidx] === "") {
				pidx++;
			}

			const lastEntry = pidx > 0 ? argList[pidx - 1] : "";
			if (
				successCount !== types.length ||
				pidx !== argList.length ||
				(typeof lastEntry === "string" &&
					lastEntry !== "" &&
					!lastEntryWasBlock)
			) {
				continue;
			}

			const nodes: AstNode[] = [];
			const injected = this.injectTransform(context, file);
			if (injected.type !== "Void") {
				nodes.push(injected);
			}
			const newContext: CompilerContext = {
				append: context.append,
				namespace: context.namespace,
				path: context.path,
				uidIndex: context.uidIndex,
				variables: context.variables,
				replacements: context.replacements,
				stack: [pos, ...context.stack],
				isTemplate: false,
				isMacro,
				templates: mergeTemplates(context.templates, this.file.templates),
				requireTemplateKeyword: true,
				compiler: context.compiler,
				globalVariables: context.globalVariables,
				functions: context.functions,
				currentFunction: context.currentFunction,
				baseNamespaceInfo: context.baseNamespaceInfo,
			};
			nodes.push(
				file.embedTransform(
					newContext,
					pos,
					args,
					overloadBody,
					useTld,
					undefined,
					false,
				),
			);
			return { type: "Group", body: nodes };
		}

		throw CompilerError.create(
			`Failed to find matching ${useTld ? "top-level (tld with) " : ""}template overload for: ${value}`,
			pos,
			context,
		);
	}

	ensureInjected(context: CompilerContext, into: McFile): void {
		this.inject(context, into);
	}
}

export class McFile {
	existingDirectories: Map<string, boolean> = new Map();
	templates: Map<string, McTemplate> = new Map();

	private exportedTemplates: Map<string, McTemplate> = new Map();
	private imports: Map<string, McFile> = new Map();
	private ext: string;
	private loadCommands: string[] = [];
	private tickCommands: string[] = [];
	private fileJs: Record<string, unknown> = {};
	private functionsDir = "functions";
	private tagsDir = "tags";
	private inlineCounter = 0;

	constructor(
		public name: string,
		private ast: AstNode[],
	) {
		this.ext = path.extname(name).replace(/^\./, "");
	}

	getTemplates(): Map<string, McTemplate> {
		if (this.ext === "mcbt") {
			return this.exportedTemplates;
		}
		throw new CompilerError(
			"tried to get templates from non-template file:" + this.name,
			true,
			[],
		);
	}

	setup(compiler: Compiler): void {
		if (compiler.config.features.useFolderRenames48) {
			this.functionsDir = "function";
		}
		const ast = this.ast;
		this.ast = [];
		for (const node of ast) {
			switch (node.type) {
				case "Import": {
					const res = compiler.resolve(this.name, node.name);
					if (res.kind === "McFile") {
						this.imports.set(node.name, res.file);
					} else {
						Object.assign(this.fileJs, res.value as object);
					}
					break;
				}
				case "TemplateDef": {
					const template = new McTemplate(node.name, node.body, this);
					this.templates.set(node.name, template);
					this.exportedTemplates.set(node.name, template);
					break;
				}
				case "Comment":
					break;
				default:
					this.ast.push(node);
					break;
			}
		}
		for (const imported of this.imports.values()) {
			const importedTemplates = imported.getTemplates();
			for (const [k, v] of importedTemplates.entries()) {
				this.templates.set(k, v);
			}
		}
	}

	private getFunctionUid(_namespace: string, _name: string): string {
		// TODO: implement unique function id generation if required by downstream features
		return "";
	}

	forkCompilerContextWithAppend(
		context: CompilerContext,
		append: (command: string) => void,
		functions: (string | null)[],
	): CompilerContext {
		return this.createCompilerContext(
			context.namespace,
			append,
			context.variables,
			context.path,
			context.uidIndex,
			context.stack,
			context.replacements,
			context.templates,
			context.requireTemplateKeyword,
			context.compiler,
			context.globalVariables,
			functions,
			context.baseNamespaceInfo,
			context.currentFunction,
			context.isMacro,
		);
	}

	createCompilerContext(
		namespace: string,
		append: (command: string) => void,
		variableMap: VariableMap,
		path: string[],
		uidIndex: UidTracker,
		stack: PosInfo[],
		replacements: VariableMap,
		templates: Map<string, McTemplate>,
		requireTemplateKeyword: boolean,
		compiler: Compiler,
		globalVariables: VariableMap,
		functions: (string | null)[],
		baseNameInfo: BaseNameInfo,
		currentFunction: string[] | null,
		isMacro: boolean,
	): CompilerContext {
		return {
			append,
			namespace,
			path: path ?? [],
			uidIndex,
			variables: variableMap,
			replacements,
			stack,
			isTemplate: this.ext === "mcbt",
			isMacro,
			templates,
			requireTemplateKeyword,
			compiler,
			globalVariables,
			functions: functions ?? [],
			baseNamespaceInfo: baseNameInfo,
			currentFunction,
		};
	}

	private saveContent(
		context: CompilerContext,
		target: string,
		content: string,
	): void {
		let output = content;
		if (
			context.compiler.config.header.length > 0 &&
			target.endsWith(".mcfunction")
		) {
			output = `${context.compiler.config.header}\n${content}`;
		}
		context.compiler.io.write(target, output);
	}

	createAnonymousFunction(
		pos: PosInfo,
		body: AstNode[],
		data: string | null,
		context: CompilerContext,
		name: string | null,
		isMacro: boolean,
	): string {
		const resolvedName = name ? this.injectValues(name, context, pos) : null;
		const commands: string[] = [];
		const uid = resolvedName ? "" : String(context.uidIndex.get());
		const id = resolvedName
			? resolvedName
			: `${context.compiler.config.generatedDirName}/${uid}`;
		let newGeneratedRoot: string[] = [];
		if (resolvedName) {
			if (resolvedName.includes("/")) {
				const segments = resolvedName.split("/");
				segments.pop();
				newGeneratedRoot = segments;
			} else {
				newGeneratedRoot = [resolvedName];
			}
		}
		const callPath = context.path.concat(
			resolvedName
				? [resolvedName]
				: [context.compiler.config.generatedDirName, uid],
		);
		const callSig = `${context.namespace}:${callPath.join("/")}`;
		const newContext = this.createCompilerContext(
			context.namespace,
			(command) => {
				commands.push(command);
			},
			context.variables.fork(),
			context.path.concat(newGeneratedRoot),
			context.uidIndex,
			context.stack,
			context.replacements,
			context.templates,
			context.requireTemplateKeyword,
			context.compiler,
			context.globalVariables,
			context.functions.concat([callSig]),
			context.baseNamespaceInfo,
			context.currentFunction,
			context.isMacro,
		);
		for (const node of body) {
			this.compileCommand(node, newContext);
		}
		const result = commands.join("\n");
		if (resolvedName) {
			name = resolvedName;
		}
		this.saveContent(
			context,
			path.join(
				"data",
				context.namespace,
				this.functionsDir,
				...context.path,
				`${id}.mcfunction`,
			),
			result,
		);
		const macroData = data ? ` ${this.injectValues(data, context, pos)}` : "";
		return this.makeMacro(
			isMacro,
			`function ${context.namespace}:${context.path.concat([id]).join("/")}${macroData}`,
		);
	}

	makeMacro(cond: boolean, command: string): string {
		return `${cond ? "$" : ""}${command}`;
	}

	private evaluateFunctionHandle(
		handle: string,
		context: CompilerContext,
		pos: PosInfo,
		_isMacro: boolean,
	): string {
		let name = this.injectValues(handle, context, pos);
		let tagPrefix = "";
		if (name.startsWith("#")) {
			tagPrefix = "#";
			name = name.substring(1);
		}

		const first = name.charAt(0);
		if (first === "^") {
			const levels = parseInt(name.substring(1), 10);
			const index = context.functions.length - levels - 1;
			const fn = index >= 0 ? context.functions[index] : null;
			if (!fn) {
				throw CompilerError.create(`Unexpected call: ${name}`, pos, context);
			}
			return `${tagPrefix}${fn}`;
		}

		if (first === "*") {
			return `${tagPrefix}${context.namespace}:${name.substring(1)}`;
		}

		if (first === ".") {
			const second = name.charAt(1);
			const third = name.charAt(2);
			if (second === "/" || (second === "." && third === "/")) {
				const base = context.currentFunction
					? [...context.currentFunction]
					: context.path.slice();
				const segments = base.concat(name.split("/"));
				const resolved: string[] = [];
				for (const segment of segments) {
					if (segment === "..") {
						if (resolved.length === 0) {
							throw CompilerError.create(`Invalid call: ${name}`, pos, context);
						}
						resolved.pop();
					} else if (segment === "." || segment === "") {
						continue;
					} else {
						resolved.push(segment);
					}
				}
				return `${tagPrefix}${context.namespace}:${resolved.join("/")}`;
			}
		}

		if (!name.includes(":") && !name.startsWith("$")) {
			throw CompilerError.create(
				"Implicit function resolution is no longer supported, please prepend your function name with ./ to achieve the same behavior.",
				pos,
				context,
			);
		}
		return `${tagPrefix}${name}`;
	}

	private compileCommand(node: AstNode, context: CompilerContext): void {
		switch (node.type) {
			case "MultiLineScript":
				this.processMlScript(context, node.pos, node.value);
				return;
			case "Raw":
				this.processTemplate(
					context,
					node.pos,
					node.value,
					node.continuations ?? null,
					node.isMacro ?? false,
				);
				return;
			case "Comment": {
				const emitted = resolveEmittedComment(node.value);
				if (emitted !== null && !context.compiler.config.dontEmitComments) {
					context.append(this.injectValues(emitted, context, node.pos));
				}
				return;
			}
			case "Block": {
				if (node.isInline) {
					if (node.data != null) {
						throw CompilerError.create(
							"Inline block cannot have data",
							node.pos,
							context,
						);
					}
					for (const child of node.body) {
						this.compileCommand(child, context);
					}
				} else {
					context.append(
						this.createAnonymousFunction(
							node.pos,
							node.body,
							node.data ?? null,
							context,
							node.name ?? null,
							node.isMacro ?? false,
						),
					);
				}
				return;
			}
			case "ReturnRun": {
				const content: string[] = [];
				const newContext = this.forkCompilerContextWithAppend(
					context,
					(value) => {
						content.push(value);
					},
					context.functions,
				);
				this.compileCommand(node.value, newContext);
				if (content.length !== 1) {
					throw CompilerError.create(
						`Expected exactly 1 command after return run, got ${content.length}`,
						node.pos,
						context,
					);
				}
				context.append(
					this.makeMacro(node.isMacro ?? false, `return run ${content[0]}`),
				);
				return;
			}
			case "CompileTimeIf":
				this.compileTimeIf(
					node.expression,
					node.body,
					node.elseExpressions,
					node.pos,
					context,
					(value) => {
						this.compileCommand(value, context);
					},
				);
				return;
			case "EqCommand": {
				const result = McMath.compile(
					this.injectValues(node.command, context, node.pos),
					context,
				);
				if (result.commands.length > 0) {
					context.append(result.commands);
				}
				const constObjective = `scoreboard objectives add ${context.compiler.config.eqConstScoreboardName} dummy`;
				if (!this.loadCommands.includes(constObjective)) {
					this.loadCommands.push(constObjective);
				}
				const varObjective = `scoreboard objectives add ${context.compiler.config.eqVarScoreboardName} dummy`;
				if (!this.loadCommands.includes(varObjective)) {
					this.loadCommands.push(varObjective);
				}
				for (const constant of result.constants) {
					const cmd = `scoreboard players set ${constant} ${context.compiler.config.eqConstScoreboardName} ${constant}`;
					if (!this.loadCommands.includes(cmd)) {
						this.loadCommands.push(cmd);
					}
				}
				return;
			}
			case "ScheduleClear": {
				const target = this.evaluateFunctionHandle(
					node.target,
					context,
					node.pos,
					node.isMacro ?? false,
				);
				context.append(
					this.makeMacro(node.isMacro ?? false, `schedule clear ${target}`),
				);
				return;
			}
			case "ScheduleCall": {
				const delay = this.injectValues(node.delay, context, node.pos);
				const mode = this.injectValues(node.mode, context, node.pos);
				const target = this.evaluateFunctionHandle(
					node.target,
					context,
					node.pos,
					node.isMacro ?? false,
				);
				context.append(
					this.makeMacro(
						node.isMacro ?? false,
						`schedule function ${target} ${delay} ${mode}`,
					),
				);
				return;
			}
			case "ScheduleBlock": {
				const delay = this.injectValues(node.delay, context, node.pos);
				const blockType = this.injectValues(node.blockType, context, node.pos);
				const commands: string[] = [];
				const append = (command: string) => {
					commands.push(command);
				};
				const id = String(context.uidIndex.get());
				const generatedPath = `${context.namespace}:${context.path
					.concat([context.compiler.config.generatedDirName, id])
					.join("/")}`;
				const newContext = this.forkCompilerContextWithAppend(
					context,
					append,
					context.functions.concat([generatedPath]),
				);
				for (const child of node.body) {
					this.compileCommand(child, newContext);
				}
				const result = commands.join("\n");
				this.saveContent(
					context,
					path.join(
						"data",
						context.namespace,
						this.functionsDir,
						...context.path,
						context.compiler.config.generatedDirName,
						`${id}.mcfunction`,
					),
					result,
				);
				context.append(
					this.makeMacro(
						node.isMacro ?? false,
						`schedule function ${generatedPath} ${delay} ${blockType}`,
					),
				);
				return;
			}
			case "FunctionCall": {
				const data = node.data ?? "";
				const suffix =
					data.length === 0
						? ""
						: ` ${this.injectValues(data, context, node.pos)}`;
				const target = this.evaluateFunctionHandle(
					node.name,
					context,
					node.pos,
					node.isMacro ?? false,
				);
				context.append(
					this.injectValues(
						this.makeMacro(
							node.isMacro ?? false,
							`function ${target}${suffix}`,
						),
						context,
						node.pos,
					),
				);
				return;
			}
			case "Execute": {
				const commands: string[] = [];
				const newContext = this.forkCompilerContextWithAppend(
					context,
					(value) => {
						commands.push(value);
					},
					context.functions,
				);
				this.compileCommand(node.value, newContext);
				if (commands.length !== 1) {
					throw CompilerError.create(
						`Expected exactly 1 command after execute, got ${commands.length}`,
						node.pos,
						context,
					);
				}
				const injected = this.injectValues(
					this.makeMacro(
						node.isMacro ?? false,
						`${node.command} ${commands[0]}`,
					),
					context,
					node.pos,
				);
				context.append(injected);
				return;
			}
			case "ExecuteBlock": {
				const commands: string[] = [];
				const append = (command: string) => {
					commands.push(command);
				};
				const uid = String(context.uidIndex.get());
				const callSignature = `${context.namespace}:${context.path
					.concat([context.compiler.config.generatedDirName, uid])
					.join("/")}`;
				const newContext = this.forkCompilerContextWithAppend(
					context,
					append,
					context.functions.concat([callSignature]),
				);
				if (node.continuations && node.continuations.length > 0) {
					context.append(
						`scoreboard players set #ifelse ${context.compiler.config.internalScoreboardName} 0`,
					);
					newContext.append(
						`scoreboard players set #ifelse ${context.compiler.config.internalScoreboardName} 1`,
					);
				}
				for (const child of node.body) {
					this.compileCommand(child, newContext);
				}
				const result = commands.join("\n");
				this.saveContent(
					context,
					path.join(
						"data",
						context.namespace,
						this.functionsDir,
						...context.path,
						context.compiler.config.generatedDirName,
						`${uid}.mcfunction`,
					),
					result,
				);
				const baseCommand = `${node.execute} function ${callSignature}`;
				let fullCommand = node.data
					? `${baseCommand} ${this.injectValues(node.data, context, node.pos)}`
					: baseCommand;
				if (node.tail) {
					const tailCommands: string[] = [];
					this.compileCommand(
						node.tail,
						this.forkCompilerContextWithAppend(
							context,
							(value) => {
								tailCommands.push(value);
							},
							context.functions,
						),
					);
					if (tailCommands.length !== 1) {
						throw CompilerError.create(
							`Expected exactly 1 command after execute block, got ${tailCommands.length}`,
							AstNodeUtils.getPos(node.tail),
							context,
						);
					}
					fullCommand = `${fullCommand} ${tailCommands[0]}`;
				}
				context.append(
					this.injectValues(
						this.makeMacro(node.isMacro ?? false, fullCommand),
						context,
						node.pos,
					),
				);

				if (node.continuations && node.continuations.length > 0) {
					node.continuations.forEach((continuation, index) => {
						const isDone = index === node.continuations!.length - 1;
						switch (continuation.type) {
							case "ExecuteBlock": {
								const embedCommands = [
									`scoreboard players set #ifelse ${context.compiler.config.internalScoreboardName} 1`,
								];
								const embedAppend = (command: string) => {
									embedCommands.push(command);
								};
								const id = String(context.uidIndex.get());
								const continuationSignature = `${context.namespace}:${context.path
									.concat([context.compiler.config.generatedDirName, id])
									.join("/")}`;
								const embedContext = this.forkCompilerContextWithAppend(
									context,
									embedAppend,
									context.functions.concat([continuationSignature]),
								);
								for (const child of continuation.body) {
									this.compileCommand(child, embedContext);
								}
								const embedResult = embedCommands.join("\n");
								this.saveContent(
									context,
									path.join(
										"data",
										context.namespace,
										this.functionsDir,
										...context.path,
										context.compiler.config.generatedDirName,
										`${id}.mcfunction`,
									),
									embedResult,
								);
								const executeCommandArgs = StringUtils.startsWithConstExpr(
									continuation.execute,
									"execute ",
								)
									? continuation.execute.substring(8)
									: continuation.execute;
								const continuationCommand = `${executeCommandArgs} function ${continuationSignature}`;
								const continuationFull = continuation.data
									? `${continuationCommand} ${this.injectValues(continuation.data, context, continuation.pos)}`
									: continuationCommand;
								context.append(
									this.makeMacro(
										continuation.isMacro ?? false,
										`execute if score #ifelse ${context.compiler.config.internalScoreboardName} matches 0 ${continuationFull}`,
									),
								);
								break;
							}
							case "Block": {
								if (!isDone) {
									throw CompilerError.createInternal(
										"block continuation must be the last continuation",
										continuation.pos,
										context,
									);
								}
								const embedCommands = [
									`scoreboard players set #ifelse ${context.compiler.config.internalScoreboardName} 1`,
								];
								const embedAppend = (command: string) => {
									embedCommands.push(command);
								};
								const id = String(context.uidIndex.get());
								const continuationSignature = `${context.namespace}:${context.path
									.concat([context.compiler.config.generatedDirName, id])
									.join("/")}`;
								const embedContext = this.forkCompilerContextWithAppend(
									context,
									embedAppend,
									context.functions.concat([continuationSignature]),
								);
								for (const child of continuation.body) {
									this.compileCommand(child, embedContext);
								}
								const embedResult = embedCommands.join("\n");
								this.saveContent(
									context,
									path.join(
										"data",
										context.namespace,
										this.functionsDir,
										...context.path,
										context.compiler.config.generatedDirName,
										`${id}.mcfunction`,
									),
									embedResult,
								);
								const dataSuffix = continuation.data
									? ` ${this.injectValues(continuation.data, context, continuation.pos)}`
									: "";
								context.append(
									this.makeMacro(
										continuation.isMacro ?? false,
										`execute if score #ifelse ${context.compiler.config.internalScoreboardName} matches 0 run function ${continuationSignature}${dataSuffix}`,
									),
								);
								break;
							}
							default:
								throw CompilerError.create(
									`Unexpected continuation type: ${JSON.stringify(continuation)}`,
									AstNodeUtils.getPos(continuation),
									context,
								);
						}
					});
				}
				return;
			}
			case "CompileTimeLoop":
				this.processCompilerLoop(
					node.expression,
					node.as ?? null,
					context,
					node.body,
					node.pos,
					(ctx, value) => {
						this.compileCommand(value, ctx);
					},
				);
				return;
			case "LoadBlock": {
				const newContext = this.forkCompilerContextWithAppend(
					context,
					(value) => {
						this.loadCommands.push(value);
					},
					context.functions.concat([null]),
				);
				for (const child of node.body) {
					this.compileCommand(child, newContext);
				}
				return;
			}
			case "TickBlock": {
				const newContext = this.forkCompilerContextWithAppend(
					context,
					(value) => {
						this.tickCommands.push(value);
					},
					context.functions.concat([null]),
				);
				for (const child of node.body) {
					this.compileCommand(child, newContext);
				}
				return;
			}
			default:
				throw CompilerError.createInternal(
					`Unexpected node type in compileCommand: ${node.type}`,
					AstNodeUtils.getPos(node),
					context,
				);
		}
	}

	private transformCommand(node: AstNode, context: CompilerContext): AstNode {
		switch (node.type) {
			case "MultiLineScript":
				return this.processMlScriptTransform(context, node.pos, node.value);
			case "Raw":
				return this.transformTemplate(
					context,
					node.pos,
					node.value,
					node.continuations ?? null,
					node.isMacro ?? false,
				);
			case "Comment": {
				const emitted = resolveEmittedComment(node.value);
				if (emitted === null || context.compiler.config.dontEmitComments) {
					return { type: "Void" };
				}
				return { ...node, value: emitted };
			}
			case "ReturnRun":
				return {
					type: "ReturnRun",
					pos: node.pos,
					value: this.transformCommand(node.value, context),
					isMacro: node.isMacro ?? false,
				};
			case "CompileTimeIf":
				return this.transformCompileTimeIf(
					node.expression,
					node.body,
					node.elseExpressions,
					node.pos,
					context,
					(value) => this.transformCommand(value, context),
				);
			case "EqCommand":
				return {
					type: "EqCommand",
					pos: node.pos,
					command: this.injectValues(node.command, context, node.pos),
				};
			case "Block":
				return {
					type: "Block",
					pos: node.pos,
					name:
						node.name != null
							? this.injectValues(node.name, context, node.pos)
							: (node.name ?? null),
					body: node.body.map((child) => this.transformCommand(child, context)),
					data:
						node.data != null
							? this.injectValues(node.data, context, node.pos)
							: (node.data ?? null),
					isMacro: node.isMacro ?? false,
					isInline: node.isInline ?? false,
				};
			case "ScheduleClear":
				return {
					type: "ScheduleClear",
					pos: node.pos,
					target: this.injectValues(node.target, context, node.pos),
					isMacro: node.isMacro ?? false,
				};
			case "ScheduleCall":
				return {
					type: "ScheduleCall",
					pos: node.pos,
					delay: this.injectValues(node.delay, context, node.pos),
					target: this.injectValues(node.target, context, node.pos),
					mode: this.injectValues(node.mode, context, node.pos),
					isMacro: node.isMacro ?? false,
				};
			case "ScheduleBlock":
				return {
					type: "ScheduleBlock",
					pos: node.pos,
					delay: this.injectValues(node.delay, context, node.pos),
					blockType: this.injectValues(node.blockType, context, node.pos),
					body: node.body.map((child) => this.transformCommand(child, context)),
					isMacro: node.isMacro ?? false,
				};
			case "FunctionCall":
				return {
					type: "FunctionCall",
					pos: node.pos,
					name: this.injectValues(node.name, context, node.pos),
					data: this.injectValues(node.data, context, node.pos),
					isMacro: node.isMacro ?? false,
				};
			case "Execute":
				return {
					type: "Execute",
					pos: node.pos,
					command: this.injectValues(node.command, context, node.pos),
					value: this.transformCommand(node.value, context),
					isMacro: node.isMacro ?? false,
				};
			case "ExecuteBlock":
				return {
					type: "ExecuteBlock",
					pos: node.pos,
					execute: this.injectValues(node.execute, context, node.pos),
					data:
						node.data != null
							? this.injectValues(node.data, context, node.pos)
							: (node.data ?? null),
					body: node.body.map((child) => this.transformCommand(child, context)),
					continuations: node.continuations
						? node.continuations.map((child) =>
								this.transformCommand(child, context),
							)
						: [],
					tail: node.tail ? this.transformCommand(node.tail, context) : null,
					isMacro: node.isMacro ?? false,
				};
			case "CompileTimeLoop": {
				const nodes: AstNode[] = [];
				this.processCompilerLoop(
					node.expression,
					node.as ?? null,
					context,
					node.body,
					node.pos,
					(ctx, value) => {
						nodes.push(this.transformCommand(value, ctx));
					},
				);
				return { type: "Group", body: nodes };
			}
			case "LoadBlock":
				return {
					type: "LoadBlock",
					pos: node.pos,
					body: node.body.map((child) => this.transformCommand(child, context)),
				};
			case "TickBlock":
				return {
					type: "TickBlock",
					pos: node.pos,
					body: node.body.map((child) => this.transformCommand(child, context)),
				};
			default:
				throw CompilerError.createInternal(
					`Unexpected node type in transformCommand: ${node.type}`,
					AstNodeUtils.getPos(node),
					context,
				);
		}
	}

	private transformFunction(
		pos: PosInfo,
		name: string,
		body: AstNode[],
		appendTo: string | null,
		context: CompilerContext,
	): AstNode {
		const injectedName = this.injectValues(name, context, pos);
		const transformedBody = body.map((node) =>
			this.transformCommand(node, context),
		);
		return {
			type: "FunctionDef",
			pos,
			name: injectedName,
			body: transformedBody,
			appendTo: appendTo ?? null,
		};
	}

	private compileFunction(
		pos: PosInfo,
		name: string,
		body: AstNode[],
		appendTo: string | null,
		context: CompilerContext,
	): void {
		const injectedName = this.injectValues(name, context, pos);
		const commands: string[] = [];
		const append = (command: string) => {
			commands.push(command);
		};
		const funcId = `${context.namespace}:${context.path.concat([injectedName]).join("/")}`;
		const newContext = this.forkCompilerContextWithAppend(
			context,
			append,
			context.functions.concat([funcId]),
		);
		newContext.currentFunction = context.path.slice();
		for (const node of body) {
			this.compileCommand(node, newContext);
		}
		if (appendTo) {
			context.compiler.tags.addTagEntry(
				this.injectValues(appendTo, context, pos),
				funcId,
				context,
			);
		}
		this.saveContent(
			context,
			path.join(
				"data",
				context.namespace,
				this.functionsDir,
				...context.path,
				`${injectedName}.mcfunction`,
			),
			commands.join("\n"),
		);
	}

	private compileDirectory(
		pos: PosInfo,
		name: string,
		body: AstNode[],
		context: CompilerContext,
	): void {
		const injectedName = this.injectValues(name, context, pos);
		const newContext = this.createCompilerContext(
			context.namespace,
			() => {
				throw CompilerError.createInternal(
					"append not available for directory context",
					pos,
					context,
				);
			},
			context.variables,
			context.path.concat([injectedName]),
			new UidTracker(),
			context.stack,
			context.replacements,
			context.templates,
			context.requireTemplateKeyword,
			context.compiler,
			context.globalVariables,
			context.functions,
			context.baseNamespaceInfo,
			context.currentFunction,
			context.isMacro,
		);
		for (const node of body) {
			this.compileTld(node, newContext);
		}
	}

	private compileTld(node: AstNode, context: CompilerContext): void {
		switch (node.type) {
			case "FunctionDef":
				if (!context.isTemplate) {
					this.compileFunction(
						node.pos,
						node.name,
						node.body,
						node.appendTo ?? null,
						context,
					);
				}
				return;
			case "Directory":
				this.compileDirectory(node.pos, node.name, node.body, context);
				return;
			case "JsonFile":
				this.compileJsonFile(node.pos, node.name, node.info, context);
				return;
			case "CompileTimeLoop":
				this.processCompilerLoop(
					node.expression,
					node.as ?? null,
					context,
					node.body,
					node.pos,
					(ctx, value) => {
						this.compileTld(value, ctx);
					},
				);
				return;
			case "CompileTimeIf":
				this.compileTimeIf(
					node.expression,
					node.body,
					node.elseExpressions,
					node.pos,
					context,
					(value) => {
						this.compileTld(value, context);
					},
				);
				return;
			case "ClockExpr": {
				const commands: string[] = [];
				const newContext = this.forkCompilerContextWithAppend(
					context,
					(value) => {
						commands.push(value);
					},
					context.functions,
				);
				const id = String(context.uidIndex.get());
				const pathSegments =
					node.name == null || node.name === ""
						? context.path.concat([
								context.compiler.config.generatedDirName,
								id,
							])
						: context.path.concat(node.name.split("/"));
				const functionId = `${context.namespace}:${pathSegments.join("/")}`;
				commands.push(`schedule function ${functionId} ${node.time} replace`);
				for (const child of node.body) {
					this.compileCommand(child, newContext);
				}
				const result = commands.join("\n");
				this.saveContent(
					context,
					path.join(
						"data",
						context.namespace,
						this.functionsDir,
						...pathSegments.slice(0, -1),
						`${pathSegments[pathSegments.length - 1]}.mcfunction`,
					),
					result,
				);
				context.compiler.tags.addTagEntry(
					"minecraft:load",
					functionId,
					context,
				);
				return;
			}
			case "MultiLineScript":
				this.processMlScript(context, node.pos, node.value, true);
				return;
			case "Comment":
				return;
			case "Raw": {
				const template = this.findTldTemplate(node, context);
				template.process(
					this,
					context,
					node.pos,
					this.stripTemplateKeyword(node.value),
					node.continuations ?? null,
					false,
					true,
				);
				return;
			}
			default:
				throw CompilerError.createInternal(
					`unexpected node type: ${node.type}`,
					AstNodeUtils.getPos(node),
					context,
				);
		}
	}

	private stripTemplateKeyword(value: string): string {
		return StringUtils.startsWithConstExpr(value, "template ")
			? value.substring("template ".length)
			: value;
	}

	// A Raw node at the top level is only valid as a call to a template with a `tld with` overload.
	private findTldTemplate(
		node: Extract<AstNode, { type: "Raw" }>,
		context: CompilerContext,
	): McTemplate {
		if (context.compiler.templateParsingEnabled) {
			const value = this.stripTemplateKeyword(node.value);
			for (const [key, template] of context.templates.entries()) {
				if (value === key || value.startsWith(`${key} `)) {
					return template;
				}
			}
		}
		throw CompilerError.create(
			`Unexpected token '${node.value}'`,
			node.pos,
			context,
		);
	}

	private transformTld(node: AstNode, context: CompilerContext): AstNode {
		switch (node.type) {
			case "FunctionDef":
				return this.transformFunction(
					node.pos,
					node.name,
					node.body,
					node.appendTo ?? null,
					context,
				);
			case "Directory":
				return {
					type: "Directory",
					pos: node.pos,
					name: this.injectValues(node.name, context, node.pos),
					body: node.body.map((child) => this.transformTld(child, context)),
				};
			case "JsonFile":
				if (node.info.kind === "Tag") {
					const mapped = node.info.entries.map((entry) => {
						if (
							entry.type === "Raw" &&
							(!entry.continuations || entry.continuations.length === 0) &&
							!(entry.isMacro ?? false)
						) {
							return {
								type: "Raw" as const,
								pos: entry.pos,
								value: this.injectValues(entry.value, context, entry.pos),
								continuations: [],
								isMacro: false,
							};
						}
						if (entry.type === "Comment") {
							return {
								type: "Raw" as const,
								pos: entry.pos,
								value: this.injectValues(entry.value, context, entry.pos),
								continuations: [],
								isMacro: false,
							};
						}
						throw CompilerError.create(
							"Unexpected node type in json tag",
							AstNodeUtils.getPos(entry),
							context,
						);
					});
					return {
						type: "JsonFile",
						pos: node.pos,
						name: this.injectValues(node.name, context, node.pos),
						info: {
							kind: "Tag",
							subType: node.info.subType,
							replace: node.info.replace,
							entries: mapped,
						},
					};
				}
				return {
					type: "JsonFile",
					pos: node.pos,
					name: this.injectValues(node.name, context, node.pos),
					info: {
						...node.info,
						...(node.info.kind === "Generic" && {
							subFolder: this.injectValues(
								node.info.subFolder,
								context,
								node.pos,
							),
						}),
						entries: this.expandJsonBody(node.info.entries, context).map(
							({ node: line, value }) => ({ ...line, value }),
						),
					},
				};
			case "CompileTimeLoop": {
				const results: AstNode[] = [];
				this.processCompilerLoop(
					node.expression,
					node.as ?? null,
					context,
					node.body,
					node.pos,
					(ctx, value) => {
						results.push(this.transformTld(value, ctx));
					},
				);
				return { type: "Group", body: results };
			}
			case "CompileTimeIf":
				return this.transformCompileTimeIf(
					node.expression,
					node.body,
					node.elseExpressions,
					node.pos,
					context,
					(value) => {
						return this.transformTld(value, context);
					},
				);
			case "ClockExpr":
				return {
					type: "ClockExpr",
					pos: node.pos,
					name: node.name,
					time: node.time,
					body: node.body.map((child) => this.transformCommand(child, context)),
				};
			case "MultiLineScript":
				return this.processMlScriptTransform(
					context,
					node.pos,
					node.value,
					true,
				);
			case "Comment":
				return node;
			case "Raw":
				return this.findTldTemplate(node, context).transform(
					this,
					context,
					node.pos,
					this.stripTemplateKeyword(node.value),
					node.continuations ?? null,
					false,
					true,
				);
			default:
				throw CompilerError.createInternal(
					`unexpected node type: ${node.type}`,
					AstNodeUtils.getPos(node),
					context,
				);
		}
	}

	private injectValues(
		target: string | null,
		context: CompilerContext,
		pos: PosInfo,
	): string {
		if (!target) {
			return "";
		}
		if (!target.includes("<%")) {
			return target;
		}

		const variables = context.variables.get();
		const argNames: string[] = ["embed", "context", "isMacro"];
		const argValues: unknown[] = [
			(value: unknown) => {
				if (
					!value ||
					typeof (value as { embedTo?: unknown }).embedTo !== "function"
				) {
					throw CompilerError.create(
						"Embed argument does not support embedTo",
						pos,
						context,
					);
				}
				return (
					value as {
						embedTo: (
							ctx: CompilerContext,
							p: PosInfo,
							file: McFile,
						) => unknown;
					}
				).embedTo(context, pos, this);
			},
			context,
			context.isMacro,
		];

		for (const [key, value] of variables.entries()) {
			argNames.push(key);
			argValues.push(value);
		}

		return injectExpressions(target, pos, (expr, exprPos) => {
			try {
				// eslint-disable-next-line no-new-func
				const fn = new Function(...argNames, `return (${expr});`);
				return fn(...argValues);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : String(error);
				throw CompilerError.create(
					`Error whilst evaluating expression: ${message}`,
					exprPos,
					context,
				);
			}
		});
	}

	static invokeExpressionInline(
		expression: string,
		context: CompilerContext,
		pos: PosInfo,
	): unknown {
		const variables = context.variables.get();
		const argNames: string[] = ["context", "isMacro"];
		const argValues: unknown[] = [context, context.isMacro];

		for (const [key, value] of variables.entries()) {
			argNames.push(key);
			argValues.push(value);
		}

		const code = `return (${expression});`;
		try {
			// eslint-disable-next-line no-new-func
			const fn = new Function(...argNames, code);
			return fn(...argValues);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw CompilerError.create(
				`Error whilst evaluating expression: ${message}`,
				pos,
				context,
			);
		}
	}

	embed(
		context: CompilerContext,
		pos: PosInfo,
		varmap: Map<string, unknown>,
		body: AstNode[],
		useTld = false,
		baseVariables: VariableMap = context.globalVariables,
	): void {
		const forked = baseVariables.fork(varmap);
		const newContext = this.createCompilerContext(
			context.namespace,
			context.append,
			forked,
			context.path,
			context.uidIndex,
			context.stack,
			context.replacements,
			context.templates,
			context.requireTemplateKeyword,
			context.compiler,
			context.globalVariables,
			context.functions,
			context.baseNamespaceInfo,
			context.currentFunction,
			context.isMacro,
		);
		for (const node of body) {
			if (useTld) {
				this.compileTld(node, newContext);
			} else {
				this.compileCommand(node, newContext);
			}
		}
	}

	embedTransform(
		context: CompilerContext,
		pos: PosInfo,
		varmap: Map<string, unknown>,
		body: AstNode[],
		useTld = false,
		baseVariables: VariableMap = context.globalVariables,
		// Injected load/tick functions are hoisted to the file root; top-level
		// template calls stay where they are so they keep their `dir` path.
		hoist = useTld,
	): AstNode {
		const forked = baseVariables.fork(varmap);
		const newContext = this.createCompilerContext(
			context.namespace,
			context.append,
			new VariableMap(VariableMap.globals, forked.get()),
			context.path,
			context.uidIndex,
			context.stack,
			context.replacements,
			context.templates,
			context.requireTemplateKeyword,
			context.compiler,
			context.globalVariables,
			context.functions,
			context.baseNamespaceInfo,
			context.currentFunction,
			context.isMacro,
		);
		const transformed = body.map((node) =>
			useTld
				? this.transformTld(node, newContext)
				: this.transformCommand(node, newContext),
		);
		const result: AstNode = { type: "Group", body: transformed };
		if (hoist) {
			context.compiler.addTopLevelAstNode(result);
			return { type: "Void" };
		}
		return result;
	}

	private transformTemplate(
		context: CompilerContext,
		pos: PosInfo,
		value: string,
		extras: AstNode[] | null,
		isMacro: boolean,
	): AstNode {
		if (context.compiler.templateParsingEnabled) {
			if (StringUtils.startsWithConstExpr(value, "template ")) {
				value = value.substring("template ".length);
			}
			for (const [key, template] of context.templates.entries()) {
				if (value === key || value.startsWith(`${key} `)) {
					return template.transform(this, context, pos, value, extras, isMacro);
				}
			}
			if (extras && extras.length > 0) {
				throw CompilerError.create(
					"Unexpected extra data in non template command",
					pos,
					context,
				);
			}
		}
		return {
			type: "Raw",
			pos,
			value: this.injectValues(value, context, pos),
			continuations: extras ?? null,
			isMacro,
		};
	}

	private processTemplate(
		context: CompilerContext,
		pos: PosInfo,
		value: string,
		extras: AstNode[] | null,
		isMacro: boolean,
	): void {
		if (context.compiler.templateParsingEnabled) {
			if (StringUtils.startsWithConstExpr(value, "template ")) {
				value = value.substring("template ".length);
			}
			for (const [key, template] of context.templates.entries()) {
				if (value === key || value.startsWith(`${key} `)) {
					template.process(this, context, pos, value, extras, isMacro);
					return;
				}
			}
			if (extras && extras.length > 0) {
				throw CompilerError.create(
					"Unexpected extra data in non template command",
					pos,
					context,
				);
			}
		}
		context.append(
			this.makeMacro(isMacro, this.injectValues(value, context, pos)),
		);
	}

	private compileInline(
		context: CompilerContext,
		code: string,
		isTLD = false,
	): void {
		const tokens = Tokenizer.tokenize(
			code,
			`<inline ${this.name}#${this.inlineCounter++}>`,
		);
		const astNodes = isTLD
			? Parser.parseInlineTLD(tokens)
			: Parser.parseInline(tokens);
		for (const node of astNodes) {
			if (isTLD) {
				this.compileTld(node, context);
			} else {
				this.compileCommand(node, context);
			}
		}
	}

	private transformInline(
		context: CompilerContext,
		code: string,
		isTLD = false,
	): AstNode {
		const tokens = Tokenizer.tokenize(
			code,
			`<inline ${this.name}#${this.inlineCounter++}>`,
		);
		const astNodes = isTLD
			? Parser.parseInlineTLD(tokens)
			: Parser.parseInline(tokens);
		const nodes: AstNode[] = [];
		if (isTLD) {
			for (const node of astNodes) {
				nodes.push(this.transformTld(node, context));
			}
		} else {
			for (const node of astNodes) {
				nodes.push(this.transformCommand(node, context));
			}
		}
		return { type: "Group", body: nodes };
	}

	private processMlScript(
		context: CompilerContext,
		pos: PosInfo,
		tokens: Token[],
		isTLD = false,
	): void {
		let scriptSource = "";
		for (const token of tokens) {
			switch (token.type) {
				case "Literal":
					scriptSource += `${token.v}\n`;
					break;
				case "BracketOpen":
					scriptSource += `{${token.data ?? ""}`;
					break;
				case "BracketClose":
					scriptSource += "}";
					break;
			}
		}

		const file = this;
		const emit: ScriptEmit = Object.assign(
			(command: string) => {
				if (typeof command !== "string") {
					throw CompilerError.create(
						`emit() expects a string command, got ${describeScriptValue(command)}. ` +
							"Use emit.mcb() to emit an AST node or a bound block, or embed() to embed a block-type template argument.",
						pos,
						context,
					);
				}
				context.append(command);
			},
			{
				mcb: (code: string | AstNode | BoundBlock,vars?:Map<string,any>) => {
					if(typeof code === "string")
						return file.compileInline(context, code, isTLD);
					if (code instanceof BoundBlock)
						code.embedDirectlyInContext(file, pos, context, vars || new Map());
					else return file.compileCommand(code,context);
				},
			},
		);

		if (!isTLD) {
			emit.block = (commands: string[], data?: string) => {
				const id = `${context.compiler.config.generatedDirName}/${String(context.uidIndex.get())}`;
				file.saveContent(
					context,
					path.join(
						"data",
						context.namespace,
						file.functionsDir,
						...context.path,
						`${id}.mcfunction`,
					),
					commands.join("\n"),
				);
				const signature = `${context.namespace}:${context.path.concat([id]).join("/")}`;
				const injectedData = data
					? file.injectValues(data, context, pos)
					: null;
				context.append(
					`function ${signature}${injectedData ? ` ${injectedData}` : ""}`,
				);
				return signature;
			};
		}

		const embed = (value: unknown) => {
			if (isTLD) {
				throw CompilerError.create(
					"embed not available in toplevel script blocks",
					pos,
					context,
				);
			}
			if (
				!value ||
				typeof (value as { embedTo?: unknown }).embedTo !== "function"
			) {
				throw CompilerError.create(
					`embed() expects a block-type template argument (a value with an .embedTo method), got ${describeScriptValue(value)}. ` +
						"Did you mean to use emit() instead?",
					pos,
					context,
				);
			}
			return (
				value as {
					embedTo: (
						ctx: CompilerContext,
						p: PosInfo,
						file: McFile,
						embed?: boolean,
					) => unknown;
				}
			).embedTo(context, pos, file);
		};

		let requireFn: (specifier: string) => unknown;
		if (context.compiler.disableRequire) {
			requireFn = (_specifier: string) => {
				throw CompilerError.create(
					"Require not available as it has been disabled, please disable compiler.disableRequire",
					pos,
					context,
				);
			};
		} else {
			const localRequire = Module.createRequire(path.resolve(this.name));
			requireFn = (specifier: string) => localRequire(specifier);
		}

		const names = ["emit", "context", "embed", "require", "isMacro"] as string[];
		const values: unknown[] = [emit, context, embed, requireFn, context.isMacro];

		const jsEnv = context.variables.get();
		for (const [key, value] of jsEnv.entries()) {
			names.push(key);
			values.push(value);
		}

		try {
			// eslint-disable-next-line no-new-func
			const fn = new Function(...names, scriptSource);
			fn(...values);
		} catch (error) {
			if (error instanceof McbError) {
				throw error;
			}
			const message = error instanceof Error ? error.message : String(error);
			throw CompilerError.create(
				`Error in multi-line script, '${message}' at ${pos.file}:${pos.line}:${pos.col + 1}`,
				pos,
				context,
			);
		}
	}

	private processMlScriptTransform(
		context: CompilerContext,
		pos: PosInfo,
		tokens: Token[],
		isTLD = false,
	): AstNode {
		let scriptSource = "";
		for (const token of tokens) {
			switch (token.type) {
				case "Literal":
					scriptSource += `${token.v}\n`;
					break;
				case "BracketOpen":
					scriptSource += `{${token.data ?? ""}`;
					break;
				case "BracketClose":
					scriptSource += "}";
					break;
			}
		}

		const file = this;
		const results: AstNode[] = [];
		const emit: ScriptEmit = Object.assign(
			(command: string) => {
				if (typeof command !== "string") {
					throw CompilerError.create(
						`emit() expects a string command, got ${describeScriptValue(command)}. ` +
							"Use emit.mcb() to emit an AST node or a bound block, or embed() to embed a block-type template argument.",
						pos,
						context,
					);
				}
				results.push({
					type: "Raw",
					pos,
					value: command,
					continuations: [],
					isMacro: false,
				});
			},
			{
				mcb: (code: string | AstNode | BoundBlock,vars?:Map<string,any>) => {
					if (typeof code === "string")
						return results.push(file.transformInline(context, code, isTLD));
					if (code instanceof BoundBlock)
						return code.embedDirectlyInContext(file, pos, context,vars || new Map());
					else return results.push(code);
				},
			},
		);

		if (!isTLD) {
			emit.block = (commands: string[], data?: string) => {
				const id = context.uidIndex.get();
				const directory: AstNode = {
					type: "Directory",
					pos,
					name: "mcb_emmited_blocks",
					body: [
						{
							type: "FunctionDef",
							pos,
							name: `block_${id}`,
							body: commands.map((c) => ({
								type: "Raw",
								pos,
								value: c,
								continuations: [],
								isMacro: false,
							})),
						},
					],
				};
				context.compiler.addTopLevelAstNode(directory);
				const signature = `${context.namespace}:${context.baseNamespaceInfo.path
					.concat(["mcb_emmited_blocks", `block_${id}`])
					.join("/")}`;
				results.push({
					type: "FunctionCall",
					pos,
					name: signature,
					data: data ? file.injectValues(data, context, pos) : "",
					isMacro: false,
				});
				return signature;
			};
		}

		const embed = (value: unknown) => {
			if (isTLD) {
				throw CompilerError.create(
					"embed not available in toplevel script blocks",
					pos,
					context,
				);
			}
			if (
				!value ||
				typeof (value as { embedTo?: unknown }).embedTo !== "function"
			) {
				throw CompilerError.create(
					`embed() expects a block-type template argument (a value with an .embedTo method), got ${describeScriptValue(value)}. ` +
						"Did you mean to use emit() instead?",
					pos,
					context,
				);
			}
			return (
				value as {
					embedTo: (
						ctx: CompilerContext,
						p: PosInfo,
						file: McFile,
						actuallyEmbed?: boolean,
					) => string;
				}
			).embedTo(context, pos, file, false);
		};

		let requireFn: (specifier: string) => unknown;
		if (context.compiler.disableRequire) {
			requireFn = (_specifier: string) => {
				throw CompilerError.create(
					"Require not available as it has been disabled, please disable compiler.disableRequire",
					pos,
					context,
				);
			};
		} else {
			const localRequire = Module.createRequire(path.resolve(this.name));
			requireFn = (specifier: string) => localRequire(specifier);
		}

		const names = ["emit", "context", "embed", "require", "isMacro"] as string[];
		const values: unknown[] = [emit, context, embed, requireFn, context.isMacro];

		const jsEnv = context.variables.get();
		for (const [key, value] of jsEnv.entries()) {
			names.push(key);
			values.push(value);
		}

		try {
			// eslint-disable-next-line no-new-func
			const fn = new Function(...names, scriptSource);
			fn(...values);
		} catch (error) {
			if (error instanceof McbError) {
				throw error;
			}
			const message = error instanceof Error ? error.message : String(error);
			throw CompilerError.create(
				`Error in multi-line script, '${message}' at ${pos.file}:${pos.line}:${pos.col + 1}`,
				pos,
				context,
			);
		}

		return { type: "Group", body: results };
	}

	private static readonly legacyPluralTagDirs = new Map<string, string>([
		["blocks", "block"],
		["items", "item"],
		["entity_types", "entity_type"],
		["fluids", "fluid"],
		["game_events", "game_event"],
	]);
	private static readonly legacySingularTagDirs = new Map<string, string>(
		Array.from(McFile.legacyPluralTagDirs, ([plural, singular]) => [
			singular,
			plural,
		]),
	);

	private getJsonFileDirectory(
		pos: PosInfo,
		info: Exclude<JsonTagType, { kind: "Tag" }>,
		context: CompilerContext,
	): string {
		const renamed = context.compiler.config.features.useFolderRenames48;
		switch (info.kind) {
			case "Generic":
				return this.injectValues(info.subFolder, context, pos);
			case "WorldGen":
				return path.join("worldgen", info.subType);
			case "Advancement":
				return renamed ? "advancement" : "advancements";
			case "ChatType":
				return "chat_type";
			case "DamageType":
				return "damage_type";
			case "Dimension":
				return "dimension";
			case "DimensionType":
				return "dimension_type";
			case "Enchantment":
				return "enchantment";
			case "ItemModifier":
				return renamed ? "item_modifier" : "item_modifiers";
			case "LootTable":
				return renamed ? "loot_table" : "loot_tables";
			case "Predicate":
				return renamed ? "predicate" : "predicates";
			case "Recipe":
				return renamed ? "recipe" : "recipes";
			default: {
				const exhaustive: never = info;
				throw CompilerError.createInternal(
					`unexpected json file kind: ${(exhaustive as JsonTagType).kind}`,
					pos,
					context,
				);
			}
		}
	}

	/** Expands a JSON body's IF/REPEAT blocks and injects `<% %>` values into each line. */
	private expandJsonBody(
		entries: AstNode[],
		context: CompilerContext,
	): Array<{ node: RawNode; value: string }> {
		const lines: Array<{ node: RawNode; value: string }> = [];
		const expand = (node: AstNode, ctx: CompilerContext): void => {
			switch (node.type) {
				case "Raw":
					lines.push({ node, value: this.injectValues(node.value, ctx, node.pos) });
					return;
				case "CompileTimeLoop":
					this.processCompilerLoop(
						node.expression,
						node.as ?? null,
						ctx,
						node.body,
						node.pos,
						(loopCtx, child) => expand(child, loopCtx),
					);
					return;
				case "CompileTimeIf":
					this.compileTimeIf(
						node.expression,
						node.body,
						node.elseExpressions,
						node.pos,
						ctx,
						(child) => expand(child, ctx),
					);
					return;
				default:
					throw CompilerError.createInternal(
						`unexpected node type in json body: ${node.type}`,
						AstNodeUtils.getPos(node),
						ctx,
					);
			}
		};
		for (const entry of entries) {
			expand(entry, context);
		}
		return lines;
	}

	/**
	 * Expands a JSON body, then parses it into minified JSON.
	 * Errors and warnings point back at the MCB source.
	 */
	private compileJsonBody(
		entries: AstNode[],
		target: string,
		context: CompilerContext,
	): string {
		const segments: Array<{ offset: number; node: RawNode; value: string }> =
			[];
		let text = "";
		for (const line of this.expandJsonBody(entries, context)) {
			segments.push({ offset: text.length, ...line });
			text += `${line.value}\n`;
		}

		const locate = (offset: number): PosInfo | null => {
			let segment = segments[0];
			for (const candidate of segments) {
				if (candidate.offset > offset) break;
				segment = candidate;
			}
			if (!segment) {
				return AstNodeUtils.getPos(entries[0]);
			}
			const { node, value } = segment;
			const column = Math.min(offset - segment.offset, node.value.length);
			const expressionIndex = node.value.indexOf("<%");
			const sourceColumn =
				value !== node.value &&
				expressionIndex !== -1 &&
				column >= expressionIndex
					? expressionIndex
					: column;
			return { ...node.pos, col: node.pos.col + sourceColumn };
		};

		let parsed: ReturnType<typeof JsonParser.parse>;
		try {
			parsed = JsonParser.parse(text);
		} catch (error) {
			if (!(error instanceof JsonSyntaxError)) {
				throw error;
			}
			const offset = Math.min(error.offset, text.trimEnd().length);
			throw CompilerError.create(
				`Invalid JSON in '${target}': ${error.message}\n\n${renderJsonPointer(text, offset)}`,
				locate(offset),
				context,
			);
		}
		for (const warning of parsed.warnings) {
			const pos = locate(warning.offset);
			context.compiler.onWarning(
				ErrorUtil.render(
					`JSON warning in '${target}': ${warning.message}`,
					pos ? [pos] : [],
				),
			);
		}
		return JsonParser.stringify(parsed.value);
	}

	private compileJsonFile(
		pos: PosInfo,
		name: string,
		info: JsonTagType,
		context: CompilerContext,
	): void {
		switch (info.kind) {
			case "Tag": {
				const injectedName = this.injectValues(name, context, pos);
				if (info.subType === "function" || info.subType === "functions") {
					const tagName = `${context.namespace}:${context.path.concat([injectedName]).join("/")}`;
					context.compiler.tags.ensureTag(tagName, context);
					for (const entry of info.entries) {
						if (
							entry.type === "Raw" &&
							(!entry.continuations || entry.continuations.length === 0) &&
							!(entry.isMacro ?? false)
						) {
							let value = this.injectValues(entry.value, context, entry.pos);
							if (value.includes(" ") && value.endsWith(" replace")) {
								value = value.substring(0, value.length - 8);
								context.compiler.tags.addTagEntry(
									tagName,
									this.evaluateFunctionHandle(value, context, entry.pos, false),
									context,
									true,
								);
							} else if (value.includes(" ")) {
								throw CompilerError.create(
									"Malformed tag entry",
									entry.pos,
									context,
								);
							} else {
								context.compiler.tags.addTagEntry(
									tagName,
									this.evaluateFunctionHandle(value, context, entry.pos, false),
									context,
									false,
								);
							}
						} else if (entry.type === "Comment") {
							let value = this.injectValues(entry.value, context, entry.pos);
							if (value.includes(" ") && value.endsWith(" replace")) {
								value = value.substring(0, value.length - 8);
								context.compiler.tags.addTagEntry(
									tagName,
									this.evaluateFunctionHandle(value, context, entry.pos, false),
									context,
									true,
								);
							} else if (value.includes(" ")) {
								throw CompilerError.create(
									"Malformed tag entry",
									entry.pos,
									context,
								);
							} else {
								context.compiler.tags.addTagEntry(
									tagName,
									this.evaluateFunctionHandle(value, context, entry.pos, false),
									context,
									false,
								);
							}
						} else {
							throw CompilerError.create(
								"Unexpected node type in json tag",
								AstNodeUtils.getPos(entry),
								context,
							);
						}
					}
					if (info.replace) {
						context.compiler.tags.setTagReplace(tagName, context, true);
					}
				} else {
					const values: Array<string | { id: string; replace: true }> = [];
					for (const entry of info.entries) {
						if (
							entry.type === "Raw" &&
							(!entry.continuations || entry.continuations.length === 0) &&
							!(entry.isMacro ?? false)
						) {
							let value = this.injectValues(entry.value, context, entry.pos);
							if (value.includes(" ") && value.endsWith(" replace")) {
								value = value.substring(0, value.length - 8);
								values.push({
									id: this.evaluateFunctionHandle(
										value,
										context,
										entry.pos,
										false,
									),
									replace: true,
								});
							} else if (value.includes(" ")) {
								throw CompilerError.create(
									"Malformed tag entry",
									entry.pos,
									context,
								);
							} else {
								values.push(
									this.evaluateFunctionHandle(value, context, entry.pos, false),
								);
							}
						} else if (entry.type === "Comment") {
							let value = this.injectValues(entry.value, context, entry.pos);
							if (value.includes(" ") && value.endsWith(" replace")) {
								value = value.substring(0, value.length - 8);
								values.push({
									id: this.evaluateFunctionHandle(
										value,
										context,
										entry.pos,
										false,
									),
									replace: true,
								});
							} else if (value.includes(" ")) {
								throw CompilerError.create(
									"Malformed tag entry",
									entry.pos,
									context,
								);
							} else {
								values.push(
									this.evaluateFunctionHandle(value, context, entry.pos, false),
								);
							}
						} else {
							throw CompilerError.create(
								"Unexpected node type in json tag",
								AstNodeUtils.getPos(entry),
								context,
							);
						}
					}
					const data = JSON.stringify({ replace: info.replace, values });
					// Only these tag folders were plural before pack format 48;
					// every other registry's tag folder has always been singular.
					const writePath = context.compiler.config.features.useFolderRenames48
						? (McFile.legacyPluralTagDirs.get(info.subType) ?? info.subType)
						: (McFile.legacySingularTagDirs.get(info.subType) ?? info.subType);
					this.saveContent(
						context,
						path.join(
							"data",
							context.namespace,
							this.tagsDir,
							writePath,
							...context.path,
							`${injectedName}.json`,
						),
						data,
					);
				}
				return;
			}
			default: {
				const injectedName = this.injectValues(name, context, pos);
				const target = path.join(
					"data",
					context.namespace,
					this.getJsonFileDirectory(pos, info, context),
					...context.path,
					`${injectedName}.json`,
				);
				this.saveContent(
					context,
					target,
					this.compileJsonBody(info.entries, target, context),
				);
				return;
			}
		}
	}

	private processCompilerLoop(
		expression: string,
		as: string[] | null,
		context: CompilerContext,
		body: AstNode[],
		pos: PosInfo,
		handler: (ctx: CompilerContext, node: AstNode) => void,
	): void {
		const iterator = McFile.invokeExpressionInline(
			expression,
			context,
			pos,
		) as any;
		if (!iterator) {
			return;
		}
		const iterable =
			typeof iterator[Symbol.iterator] === "function"
				? (iterator as Iterable<any>)
				: typeof iterator.next === "function"
					? ({
							[Symbol.iterator]() {
								return iterator;
							},
						} as Iterable<any>)
					: null;
		if (!iterable) {
			throw CompilerError.create(
				"Invalid iterator returned from expression",
				pos,
				context,
			);
		}
		for (const value of iterable) {
			if (!as || as.length === 0) {
				for (const node of body) {
					handler(context, node);
				}
			} else {
				const varMap = new Map<string, unknown>();
				if (as.length === 1) {
					varMap.set(as[0], value);
				} else if (Array.isArray(value)) {
					if (value.length < as.length) {
						throw CompilerError.create(
							"Failed to destructure as there are fewer elements then requested",
							pos,
							context,
						);
					}
					as.forEach((name, index) => {
						varMap.set(name, value[index]);
					});
				} else {
					throw CompilerError.create("Invalid as clause", pos, context);
				}
				const newContext = this.createCompilerContext(
					context.namespace,
					context.append,
					context.variables.fork(varMap),
					context.path,
					context.uidIndex,
					context.stack,
					context.replacements,
					context.templates,
					context.requireTemplateKeyword,
					context.compiler,
					context.globalVariables,
					context.functions,
					context.baseNamespaceInfo,
					context.currentFunction,
					context.isMacro,
				);
				for (const node of body) {
					handler(newContext, node);
				}
			}
		}
	}

	private transformCompileTimeIf(
		expression: string,
		body: AstNode[],
		elseExpressions: CompileTimeIfElseExpressions,
		pos: PosInfo,
		context: CompilerContext,
		processNode: (node: AstNode) => AstNode,
	): AstNode {
		const condition = McFile.invokeExpressionInline(expression, context, pos);
		if (condition) {
			return { type: "Group", body: body.map(processNode) };
		}
		for (const elseNode of elseExpressions) {
			const invoke =
				elseNode.condition == null
					? true
					: Boolean(
							McFile.invokeExpressionInline(elseNode.condition, context, pos),
						);
			if (invoke) {
				return { type: "Group", body: elseNode.node.map(processNode) };
			}
		}
		return { type: "Void" };
	}

	private compileTimeIf(
		expression: string,
		body: AstNode[],
		elseExpressions: CompileTimeIfElseExpressions,
		pos: PosInfo,
		context: CompilerContext,
		processNode: (node: AstNode) => void,
	): void {
		const condition = McFile.invokeExpressionInline(expression, context, pos);
		if (condition) {
			for (const node of body) {
				processNode(node);
			}
			return;
		}
		for (const elseNode of elseExpressions) {
			const invoke =
				elseNode.condition == null
					? true
					: Boolean(
							McFile.invokeExpressionInline(elseNode.condition, context, pos),
						);
			if (invoke) {
				for (const node of elseNode.node) {
					processNode(node);
				}
				return;
			}
		}
	}

	compile(vars: VariableMap, compiler: Compiler): void {
		const info = compiler.getInitialPathInfo(this.name);
		const jsVars = new Map<string, unknown>();
		for (const [key, value] of Object.entries(this.fileJs)) {
			jsVars.set(key, value);
		}
		const thisFileVars = new VariableMap(vars, jsVars);
		const context = this.createCompilerContext(
			info.namespace,
			() => {
				throw new Error("append not available for top-level context");
			},
			new VariableMap(thisFileVars, Globals.map),
			info.path,
			new UidTracker(),
			[],
			new VariableMap(null, new Map()),
			this.templates,
			this.ext === "mcbt",
			compiler,
			thisFileVars,
			[],
			info,
			null,
			false,
		);
		context.append = (_command: string) => {
			throw CompilerError.create(
				"append not available for top-level context",
				null,
				context,
			);
		};

		if (context.isTemplate) {
			if (this.ast.length > 0) {
				throw CompilerError.create(
					"Unexpected top-level content in template file",
					AstNodeUtils.getPos(this.ast[0]),
					context,
				);
			}
			return;
		}

		for (const node of this.ast) {
			if (node.type === "Import" || node.type === "TemplateDef") {
				throw CompilerError.create(
					"import or template definition found after setup",
					AstNodeUtils.getPos(node),
					context,
				);
			}
			this.compileTld(node, context);
		}

		if (this.loadCommands.length > 0) {
			this.saveContent(
				context,
				path.join(
					"data",
					context.namespace,
					this.functionsDir,
					...context.path,
					context.compiler.config.generatedDirName,
					"load.mcfunction",
				),
				this.loadCommands.join("\n"),
			);
			compiler.tags.addTagEntry(
				"minecraft:load",
				`${context.namespace}:${context.path.concat([context.compiler.config.generatedDirName, "load"]).join("/")}`,
				context,
			);
		}

		if (this.tickCommands.length > 0) {
			this.saveContent(
				context,
				path.join(
					"data",
					context.namespace,
					this.functionsDir,
					...context.path,
					context.compiler.config.generatedDirName,
					"tick.mcfunction",
				),
				this.tickCommands.join("\n"),
			);
			compiler.tags.addTagEntry(
				"minecraft:tick",
				`${context.namespace}:${context.path.concat([context.compiler.config.generatedDirName, "tick"]).join("/")}`,
				context,
			);
		}
	}

	transform(vars: VariableMap, compiler: Compiler): AstNode[] {
		const info = compiler.getInitialPathInfo(this.name);
		const jsVars = new Map<string, unknown>();
		for (const [key, value] of Object.entries(this.fileJs)) {
			jsVars.set(key, value);
		}
		const thisFileVars = new VariableMap(vars, jsVars);
		const context = this.createCompilerContext(
			info.namespace,
			() => {
				throw new Error("append not available for top-level context");
			},
			new VariableMap(thisFileVars, Globals.map),
			info.path,
			new UidTracker(),
			[],
			new VariableMap(null, new Map()),
			this.templates,
			this.ext === "mcbt",
			compiler,
			thisFileVars,
			[],
			info,
			null,
			false,
		);
		context.append = (_command: string) => {
			throw CompilerError.create(
				"append not available for top-level context",
				null,
				context,
			);
		};

		if (context.isTemplate) {
			if (this.ast.length > 0) {
				throw CompilerError.create(
					"Unexpected top-level content in template file",
					AstNodeUtils.getPos(this.ast[0]),
					context,
				);
			}
			return [{ type: "Void" }];
		}

		const result: AstNode[] = [];
		for (const node of this.ast) {
			if (node.type === "Import" || node.type === "TemplateDef") {
				throw CompilerError.create(
					"import or template definition found after setup",
					AstNodeUtils.getPos(node),
					context,
				);
			}
			result.push(this.transformTld(node, context));
		}
		return result;
	}
}

TemplateArgument.setInlineEvaluator(McFile.invokeExpressionInline);

export class Compiler {
	io: IoLike;
	tags: TagManager = new TagManager();
	packNamespace = `mcb-${Date.now()}`;
	config: Config;
	disableRequire = false;
	templateParsingEnabled = true;
	success = true;
	/** Receives non-fatal build warnings, like duplicate JSON keys. */
	onWarning: (message: string) => void = (message) => console.warn(message);

	private files: Map<string, McFile> = new Map();
	private alreadySetupFiles: Map<string, boolean> = new Map();
	private topLevelAstNodes: AstNode[] = [];

	constructor(
		public baseDir: string,
		config: UserConfig,
		configDir: string = baseDir,
	) {
		this.config = Config.create(config, configDir);
		this.io = this.config.io ?? {
			write() {},
			cleanup() {},
			finished() {
				return true;
			},
		};
	}

	addFile(name: string, ast: AstNode[]): void {
		const normalizedName = Compiler.normalizeProjectPath(name);
		const file = new McFile(normalizedName, ast);
		this.files.set(normalizedName, file);
	}

	resolve(baseFile: string, resolutionPath: string): ImportFileType {
		const base = resolutionPath.startsWith("/")
			? this.baseDir
			: path.dirname(baseFile);
		const resolved = path.join(
			base,
			resolutionPath.startsWith("/")
				? resolutionPath.substring(1)
				: resolutionPath,
		);
		const normalizedResolved = Compiler.normalizeProjectPath(resolved);
		const ext = path.extname(resolutionPath);
		if (ext.endsWith("js") || ext === ".json") {
			const value = selfRequire(resolved);
			return { kind: "JsFile", value };
		}
		if (this.files.has(normalizedResolved)) {
			if (!this.alreadySetupFiles.has(normalizedResolved)) {
				this.alreadySetupFiles.set(normalizedResolved, true);
				this.files.get(normalizedResolved)!.setup(this);
			}
			return { kind: "McFile", file: this.files.get(normalizedResolved)! };
		}
		throw new CompilerError("Failed to resolve import: " + resolved, false, []);
	}

	private static withoutExtension(value: string): string {
		if (!value) {
			return value;
		}
		const lastSlash = value.lastIndexOf("/");
		const lastDot = value.lastIndexOf(".");
		if (lastDot === -1 || (lastSlash !== -1 && lastDot <= lastSlash)) {
			return value;
		}
		return value.substring(0, lastDot);
	}

	static normalizeProjectPath(value: string): string {
		if (!value) {
			return "";
		}
		const replaced = value.replace(/\\/g, "/");
		const normalized = path.posix.normalize(replaced);
		return normalized === "." ? "" : normalized;
	}

	getInitialPathInfo(p: string): BaseNameInfo {
		const normalizedBase = Compiler.normalizeProjectPath(this.baseDir);
		const normalizedInput = Compiler.normalizeProjectPath(p);

		let relative = normalizedInput;
		if (
			normalizedBase.length > 0 &&
			normalizedInput.startsWith(normalizedBase)
		) {
			relative = normalizedInput.substring(normalizedBase.length);
		}
		relative = relative.replace(/^\/+/, "");

		if (relative.length === 0) {
			return { namespace: "", path: [] };
		}

		const parts = relative.split("/").filter((segment) => segment.length > 0);
		const namespaceWithExt = parts.shift() ?? "";
		const namespace = Compiler.withoutExtension(namespaceWithExt);
		const restJoined = parts.join("/");
		const restWithoutExtension = Compiler.withoutExtension(restJoined);
		const pathParts =
			restWithoutExtension.length > 0 ? restWithoutExtension.split("/") : [];

		return {
			namespace,
			path: pathParts,
		};
	}

	compile(root: VariableMap): void {
		this.success = true;
		try {
			for (const file of this.files.values()) {
				if (this.alreadySetupFiles.has(file.name)) {
					continue;
				}
				file.setup(this);
			}
			for (const file of this.files.values()) {
				file.compile(root, this);
			}
			this.tags.writeTagFiles(this);
		} catch (error) {
			this.success = false;
			throw error;
		}
	}

	transform(root: VariableMap): Map<string, AstNode> {
		const result = new Map<string, AstNode>();
		for (const file of this.files.values()) {
			if (!this.alreadySetupFiles.has(file.name)) {
				file.setup(this);
			}
		}
		for (const file of this.files.values()) {
			this.topLevelAstNodes = [];
			const nodes = file.transform(root, this).concat(this.topLevelAstNodes);
			result.set(file.name, { type: "Group", body: nodes });
		}
		return result;
	}

	addTopLevelAstNode(node: AstNode): void {
		this.topLevelAstNodes.push(node);
	}
}

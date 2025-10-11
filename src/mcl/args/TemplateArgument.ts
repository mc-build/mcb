import { PosInfo } from "../Tokenizer";
import type { CompilerContext } from "../Compiler";

export type TemplateParseResult = {
	success: boolean;
	value?: unknown;
	raw?: unknown;
};

export type TemplateArgumentConstructor = new (
	name: string | null,
	pos: PosInfo,
) => TemplateArgument;

type InlineEvaluator = (
	script: string,
	context: CompilerContext,
	pos: PosInfo,
) => unknown;

type BlockEvaluator = (
	code: string,
	context: CompilerContext,
	pos: PosInfo,
	isTLD?: boolean,
) => void;

type TransformEvaluator = (
	code: string,
	context: CompilerContext,
	pos: PosInfo,
	isTLD?: boolean,
) => unknown;

export abstract class TemplateArgument {
	name: string | null;
	pos: PosInfo;
	expectBlock = false;
	expectJsValue = false;

	static jsCache: Map<number, unknown> | null = null;
	static jsCacheIdx = 0;
	static argumentTypes = new Map<string, TemplateArgumentConstructor>();

	private static inlineEvaluator: InlineEvaluator | null = null;

	protected constructor(name: string | null, pos: PosInfo) {
		this.name = name;
		this.pos = pos;
	}

	static register(type: string, ctor: TemplateArgumentConstructor): void {
		if (TemplateArgument.argumentTypes.has(type)) {
			throw new Error(`Template argument type already registered: ${type}`);
		}
		TemplateArgument.argumentTypes.set(type, ctor);
	}

	static parse(source: string, pos: PosInfo): TemplateArgument {
		const colonIndex = source.indexOf(":");
		const type =
			colonIndex === -1 ? "literal" : source.substring(colonIndex + 1);
		const name = colonIndex === -1 ? source : source.substring(0, colonIndex);
		const ctor = TemplateArgument.argumentTypes.get(type);
		if (!ctor) {
			throw new Error(`Unknown template argument type: '${type}'`);
		}
		return new ctor(name, pos);
	}

	static resetJsCache(cache: Map<number, unknown>): void {
		TemplateArgument.jsCache = cache;
		TemplateArgument.jsCacheIdx = 0;
	}

	static setInlineEvaluator(evaluator: InlineEvaluator): void {
		TemplateArgument.inlineEvaluator = evaluator;
	}

	static evaluateInlineExpression(
		script: string,
		context: CompilerContext,
		pos: PosInfo,
	): unknown {
		if (!TemplateArgument.inlineEvaluator) {
			throw new Error("Inline evaluator not configured");
		}
		return TemplateArgument.inlineEvaluator(script, context, pos);
	}

	abstract parseValue(
		value: string,
		pos: PosInfo,
		context: CompilerContext,
	): TemplateParseResult;

	parseValueBlock(
		_value: unknown,
		_pos: PosInfo,
		_context: CompilerContext,
	): TemplateParseResult {
		throw new Error("override parseValueBlock in subclass");
	}
}

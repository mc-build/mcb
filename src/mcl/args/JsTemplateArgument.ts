import type { CompilerContext } from "../Compiler";
import { PosInfo } from "../Tokenizer";
import { StringUtils } from "../../strutils/StringUtils";
import { TemplateArgument, TemplateParseResult } from "./TemplateArgument";

export class JsTemplateArgument extends TemplateArgument {
	static register(): void {
		TemplateArgument.register("js", JsTemplateArgument);
	}

	constructor(name: string | null, pos: PosInfo) {
		super(name, pos);
		this.expectJsValue = true;
	}

	parseValue(
		value: string,
		pos: PosInfo,
		context: CompilerContext,
	): TemplateParseResult {
		if (!StringUtils.startsWithConstExpr(value, "<%")) {
			return { success: false };
		}
		const end = value.indexOf("%>");
		if (end === -1) {
			return { success: false };
		}
		const script = value.substring(2, end);
		const cache = TemplateArgument.jsCache ?? new Map<number, unknown>();
		if (!TemplateArgument.jsCache) {
			TemplateArgument.jsCache = cache;
		}
		try {
			const idx = TemplateArgument.jsCacheIdx;
			let result: unknown;
			if (cache.has(idx)) {
				result = cache.get(idx);
			} else {
				result = TemplateArgument.evaluateInlineExpression(
					script,
					context,
					pos,
				);
				cache.set(idx, result);
			}
			return { success: true, value: result, raw: value.substring(0, end + 2) };
		} catch (error) {
			return { success: false };
		}
	}
}

import type { CompilerContext } from "../Compiler";
import { PosInfo } from "../Tokenizer";
import { injectExpressions } from "../InlineExpressionUtils";
import { TemplateArgument, TemplateParseResult } from "./TemplateArgument";

export class WordTemplateArgument extends TemplateArgument {
	static register(): void {
		TemplateArgument.register("word", WordTemplateArgument);
	}

	constructor(name: string | null, pos: PosInfo) {
		super(name, pos);
	}

	parseValue(
		value: string,
		pos: PosInfo,
		context: CompilerContext,
	): TemplateParseResult {
		if (!value) {
			return { success: false };
		}
		const spaceIdx = value.indexOf(" ");
		const word = spaceIdx === -1 ? value : value.substring(0, spaceIdx);
		// Resolve any <%...%> expressions embedded in the word against the
		// calling context now, while it's still available - see
		// RawTemplateArgument for why this can't be deferred to when the
		// template body eventually uses this value.
		const injected = injectExpressions(word, pos, (expr, exprPos) =>
			TemplateArgument.evaluateInlineExpression(expr, context, exprPos),
		);
		// `raw` must stay the original, unevaluated word: callers use its
		// length to figure out how much of the source was consumed by this
		// argument when parsing the next one.
		return { success: true, value: injected, raw: word };
	}
}

import type { CompilerContext } from "../Compiler";
import { PosInfo } from "../Tokenizer";
import { injectExpressions } from "../InlineExpressionUtils";
import { TemplateArgument, TemplateParseResult } from "./TemplateArgument";

export class RawTemplateArgument extends TemplateArgument {
	static register(): void {
		TemplateArgument.register("raw", RawTemplateArgument);
	}

	constructor(name: string | null, pos: PosInfo) {
		super(name, pos);
	}

	parseValue(
		value: string,
		pos: PosInfo,
		context: CompilerContext,
	): TemplateParseResult {
		// Resolve any <%...%> expressions embedded in the raw text against the
		// calling context now, while it's still available. Templates commonly
		// reassemble "raw" arguments into a new command string and re-emit it
		// via emit.mcb(), which recompiles that string in the template's own
		// (deliberately caller-variable-free) scope - so any <%...%> markers
		// left unresolved in `value` would otherwise lose access to things
		// like a REPEAT loop's `as` binding once they reach that point.
		const injected = injectExpressions(value, pos, (expr, exprPos) =>
			TemplateArgument.evaluateInlineExpression(expr, context, exprPos),
		);
		// `raw` must stay the original, unevaluated text: callers use its
		// length to figure out how much of the source was consumed by this
		// argument when parsing the next one.
		return { success: true, value: injected, raw: value };
	}
}

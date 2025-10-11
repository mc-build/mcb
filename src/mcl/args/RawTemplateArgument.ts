import type { CompilerContext } from "../Compiler";
import { PosInfo } from "../Tokenizer";
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
		_pos: PosInfo,
		_context: CompilerContext,
	): TemplateParseResult {
		return { success: true, value, raw: value };
	}
}

import type { CompilerContext } from "../Compiler";
import { PosInfo } from "../Tokenizer";
import { TemplateArgument, TemplateParseResult } from "./TemplateArgument";

export class FloatTemplateArgument extends TemplateArgument {
	static register(): void {
		TemplateArgument.register("float", FloatTemplateArgument);
	}

	constructor(name: string | null, pos: PosInfo) {
		super(name, pos);
	}

	parseValue(
		value: string,
		_pos: PosInfo,
		_context: CompilerContext,
	): TemplateParseResult {
		const spaceIdx = value.indexOf(" ");
		const slice = spaceIdx === -1 ? value : value.substring(0, spaceIdx);
		const parsed = Number.parseFloat(slice);
		if (Number.isNaN(parsed)) {
			return { success: false };
		}
		return { success: true, value: parsed, raw: slice };
	}
}

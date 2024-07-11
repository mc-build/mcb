package mcl.args;

import mcl.Compiler.CompilerContext;
import mcl.args.TemplateArgument.TemplateParseResult;
import mcl.Tokenizer.PosInfo;

class FloatTemplateArgument extends TemplateArgument {
	public static function register() {
		TemplateArgument.register("float", FloatTemplateArgument);
	}

	public override function parseValue(value:String, pos:PosInfo, ctx:CompilerContext):TemplateParseResult {
		var spaceIdx = value.indexOf(" ");
		if (spaceIdx != -1) {
			value = value.substring(0, spaceIdx);
		}
		var intValue = Std.parseFloat(value);
		if (intValue == null) {
			return {
				success: false,
			}
		}
		return {
			success: true,
			value: intValue,
			raw: value
		}
	}
}

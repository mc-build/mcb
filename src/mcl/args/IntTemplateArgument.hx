package mcl.args;

import mcl.args.TemplateArgument.TemplateParseResult;
import mcl.Tokenizer.PosInfo;

class IntTemplateArgument extends TemplateArgument {
	public static function register() {
		TemplateArgument.register("int", IntTemplateArgument);
	}

	public override function parseValue(value:String, pos:PosInfo):TemplateParseResult {
		var spaceIdx = value.indexOf(" ");
		if (spaceIdx != -1) {
			value = value.substring(0, spaceIdx);
		}
		var intValue = Std.parseInt(value);
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

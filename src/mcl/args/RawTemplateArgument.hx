package mcl.args;

import mcl.Tokenizer.PosInfo;
import mcl.args.TemplateArgument;

class RawTemplateArgument extends TemplateArgument {
	public static function register():Void {
		TemplateArgument.register("raw", RawTemplateArgument);
	}

	public override function parseValue(value:String, pos:PosInfo):TemplateParseResult {
		return {
			success: true,
			value: value,
			raw: value
		}
	}
}

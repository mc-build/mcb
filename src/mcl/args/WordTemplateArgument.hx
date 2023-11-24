package mcl.args;

import mcl.Compiler.CompilerContext;
import mcl.Tokenizer.PosInfo;
import mcl.args.TemplateArgument;

class WordTemplateArgument extends TemplateArgument {
	public static function register():Void {
		TemplateArgument.register("word", WordTemplateArgument);
	}

	public override function parseValue(value:String, pos:PosInfo, ctx:CompilerContext):TemplateParseResult {
		if (value == '')
			return {
				success: false
			};
		var split = value.indexOf(" ");
		var res = split == -1 ? value : value.substr(0, split);
		return {
			success: true,
			value: res,
			raw: res
		}
	}
}

package mcl.args;

import mcl.Compiler.CompilerContext;
import mcl.Tokenizer.PosInfo;
import mcl.args.TemplateArgument.TemplateParseResult;

class JsTemplateArgument extends TemplateArgument {
	public static function register() {
		TemplateArgument.register('js', JsTemplateArgument);
	}

	public override function parseValue(value:String, pos:PosInfo, ctx:CompilerContext):TemplateParseResult {
		if (StringTools.startsWith(value, "<%")) {
			var end = value.indexOf("%>");
			if (end == -1)
				return {success: false};
			var code = value.substring(2, end);
			try {
				return {success: true, value: mcl.Compiler.McFile.invokeExpressionInline(code, ctx, pos), raw: value.substring(0, end + 2)};
			} catch (e:Dynamic) {
				return {success: false};
			}
		}
		return {success: false};
	}
}

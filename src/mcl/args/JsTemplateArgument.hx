package mcl.args;

import strutils.StringUtils;
import mcl.Compiler.CompilerContext;
import mcl.Tokenizer.PosInfo;
import mcl.args.TemplateArgument.TemplateParseResult;

class JsTemplateArgument extends TemplateArgument {
	public static function register() {
		TemplateArgument.register('js', JsTemplateArgument);
	}

	public function new(s:String, p:PosInfo) {
		super(s, p);
		expectJsValue = true;
	}

	public override function parseValue(value:String, pos:PosInfo, ctx:CompilerContext):TemplateParseResult {
		if (StringUtils.startsWithConstExpr(value, "<%")) {
			var end = value.indexOf("%>");
			if (end == -1)
				return {success: false};
			var code = value.substring(2, end);
			try {
				var idx = TemplateArgument.jsCacheIdx;
				var alreadyParsed = TemplateArgument.jsCache.exists(idx);
				var v:Any;
				if (!alreadyParsed) {
					v = mcl.Compiler.McFile.invokeExpressionInline(code, ctx, pos);
					TemplateArgument.jsCache.set(idx, v);
				} else {
					v = TemplateArgument.jsCache.get(idx);
				}
				return {success: true, value: v, raw: value.substring(0, end + 2)};
			} catch (e:Dynamic) {
				return {success: false};
			}
		}
		return {success: false};
	}
}

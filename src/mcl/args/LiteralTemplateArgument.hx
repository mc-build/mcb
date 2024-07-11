package mcl.args;

import mcl.args.TemplateArgument.TemplateParseResult;
import mcl.Compiler.CompilerContext;
import mcl.Tokenizer.PosInfo;

class LiteralTemplateArgument extends TemplateArgument {
	public static function register() {
		TemplateArgument.register('literal', JsTemplateArgument);
	}

	var value:String;

	public function new(pos:PosInfo, value:String) {
		this.value = value;
		super(null, pos);
	}

	public override function parseValue(value:String, pos:PosInfo, ctx:CompilerContext):TemplateParseResult {
		if (value == this.value || StringTools.startsWith(value, this.value + ' ')) {
			return {success: true, value: value, raw: this.value};
		}
		return {success: false};
	}
}

package mcl;

import mcl.args.WordTemplateArgument;
import mcl.args.FloatTemplateArgument;
import mcl.args.BlockTemplateArgument;
import mcl.args.JsTemplateArgument;
import mcl.args.IntTemplateArgument;
import mcl.args.RawTemplateArgument;

class TemplateRegisterer {
	public static function register() {
		RawTemplateArgument.register();
		IntTemplateArgument.register();
		JsTemplateArgument.register();
		BlockTemplateArgument.register();
		FloatTemplateArgument.register();
		WordTemplateArgument.register();
	}
}

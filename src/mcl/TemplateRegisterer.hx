package mcl;

import mcl.args.IntTemplateArgument;
import mcl.args.RawTemplateArgument;

class TemplateRegisterer {
	public static function register() {
		RawTemplateArgument.register();
		IntTemplateArgument.register();
	}
}

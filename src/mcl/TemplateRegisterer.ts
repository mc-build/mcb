import { BlockTemplateArgument } from "./args/BlockTemplateArgument";
import { FloatTemplateArgument } from "./args/FloatTemplateArgument";
import { IntTemplateArgument } from "./args/IntTemplateArgument";
import { JsTemplateArgument } from "./args/JsTemplateArgument";
import { LiteralTemplateArgument } from "./args/LiteralTemplateArgument";
import { RawTemplateArgument } from "./args/RawTemplateArgument";
import { WordTemplateArgument } from "./args/WordTemplateArgument";

let registered = false;

export const TemplateRegisterer = {
	register(): void {
		if (registered) {
			return;
		}
		registered = true;
		RawTemplateArgument.register();
		IntTemplateArgument.register();
		JsTemplateArgument.register();
		BlockTemplateArgument.register();
		FloatTemplateArgument.register();
		WordTemplateArgument.register();
		LiteralTemplateArgument.register();
	},
};

import { PosInfo } from "../Tokenizer";
import { ErrorUtil } from "./CompilerError";
import { McbError } from "./McbError";

export class ParserError extends McbError {
	constructor(message: string, pos: PosInfo | null = null) {
		super(
			`Parser Error:\n\t${ErrorUtil.render(message, pos ? [pos] : [])}`,
			pos ? [pos] : [],
		);
		this.name = "ParserError";
	}
}

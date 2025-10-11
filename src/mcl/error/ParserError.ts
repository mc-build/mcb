import { McbError } from "./McbError";

export class ParserError extends McbError {
	constructor(message: string) {
		super(`Parser Error:\n\t${message}`, []);
		this.name = "ParserError";
	}
}

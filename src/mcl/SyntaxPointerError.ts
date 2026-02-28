import { StreamPosition, StringStream } from "./StringStream";
import { CHARS } from "./Tokenizer";

export interface SyntaxPointerErrorOptions {
	child?: Error;
	pointerLength?: number;
}

/**
 * An error that points to a specific location in a StringStream
 *
 * Example:
 *```md
 * > Unexpected '}' at 1:5
 * > Hello, World!"}
 * >               ↑
 *```
 */
export class SyntaxPointerError extends Error {
	private originalMessage: string;

	child?: Error;
	pointerLength: number;

	constructor(
		message: string,
		public source: string,
		public line: number,
		public column: number,
		{ child, pointerLength }: SyntaxPointerErrorOptions = {},
	) {
		super(message);
		this.name = `SyntaxPointerError`;
		this.child = child;
		this.pointerLength = pointerLength ?? 1;
		this.originalMessage = message;

		if (this.child) {
			this.message = `${this.message} at ${this.line}:${this.column}\n${this.child.message}`;
			return;
		}

		this.updatePointerMessage();
	}

	getOriginErrorMessage(): string {
		if (this.child) {
			if (this.child instanceof SyntaxPointerError) {
				return this.child.getOriginErrorMessage();
			}
			return this.child.message;
		}
		return this.message;
	}

	updatePointerMessage() {
		const lines = this.source.split(`\n`);
		const start = lines
			.slice(0, this.line - 1)
			.reduce((acc, cur) => acc + cur.length + 1, 0);
		const end = start + lines[this.line - 1].length;

		const lineString = this.source.slice(start, end).replace(/\t/g, "    ");

		// Get column where tabs count as 4 characters
		const column = this.source
			.slice(start, start + this.column - 1)
			.replace(/\t/g, "    ").length;

		const pointer = " ".repeat(column) + "↑".repeat(this.pointerLength);
		this.message = `${this.originalMessage} at ${this.line}:${this.column}\n${lineString}\n${pointer}`;
	}
}

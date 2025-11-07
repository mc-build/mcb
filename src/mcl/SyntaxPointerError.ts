import { StreamPosition, StringStream } from "./StringStream";
import { CHARS } from "./TokenizerImpl";

export interface SyntaxPointerErrorOptions {
	child?: Error;
	line?: number;
	column?: number;
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
	line: number;
	column: number;
	pointerLength: number;

	constructor(
		message: string,
		public stream: StringStream,
		{ child, line, column, pointerLength }: SyntaxPointerErrorOptions = {},
	) {
		super(message);
		this.name = `SyntaxPointerError`;
		this.child = child;
		this.pointerLength = pointerLength ?? 1;
		this.line = line ?? stream.line;
		this.column = column ?? stream.column;
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
		const start = this.stream.lines[this.line - 1].index;
		const end = this.stream.indexOf(CHARS.NEWLINE, start);

		const lineString = this.stream.slice(start, end).replace(/\t/g, "    ");

		// Get column where tabs count as 4 characters
		const column = this.stream
			.slice(start, start + this.column - 1)
			.replace(/\t/g, "    ").length;

		const pointer = " ".repeat(column) + "↑".repeat(this.pointerLength);
		this.message = `${this.originalMessage} at ${this.line}:${this.column}\n${lineString}\n${pointer}`;
	}
}

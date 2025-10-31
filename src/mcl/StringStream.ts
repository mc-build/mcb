interface Line {
	number: number;
	index: number;
}

export interface StreamPosition {
	/** The first line is index 1 */
	line: number;
	/** The first column is index 1 */
	column: number;
}

const enum CHARS {
	NEWLINE = 10,
	SPACE = 32,
	TAB = 9,
}

/**
 * A simple string stream class.
 * Useful for language parsing
 */
export class StringStream {
	protected _lines?: Line[];
	protected buffer: Buffer;

	index = 0;
	line = 1;
	column = 1;

	indexOf: Buffer["indexOf"];
	slice: (start?: number, end?: number) => string;

	/**
	 * @param str An array of characters
	 */
	constructor(str: string) {
		this.buffer = Buffer.from(str.replace(/\r/, ``));
		this.indexOf = this.buffer.indexOf.bind(this.buffer);
		this.slice = this.buffer.toString.bind(this.buffer, `utf-8`);
	}

	get lines(): Line[] {
		if (!this._lines) {
			this._lines = [];
			const lines = this.buffer.toString().split(`\n`);
			let startIndex = 0;
			for (let i = 0; i < lines.length; i++) {
				this._lines.push({ number: i + 1, index: startIndex });
				startIndex += lines[i].length + 1; // +1 for the newline character
			}
		}
		return this._lines;
	}

	get currentLine(): Line {
		return this.lines[this.line - 1];
	}

	get length(): number {
		return this.buffer.length;
	}

	/**
	 * The progress of the stream from 0 to 1
	 */
	get progress(): number {
		return Math.min(this.index / this.length, 1);
	}

	/**
	 * The previous char code in the stream
	 */
	get previous(): number | undefined {
		return this.buffer[this.index - 1];
	}

	/**
	 * The current char code in the stream
	 */
	get item(): number {
		return this.buffer[this.index];
	}

	/**
	 * The next char code in the stream
	 */
	get next(): number | undefined {
		return this.buffer[this.index + 1];
	}

	/**
	 * Returns the char code at the specified {@link index}
	 */
	at(index: number): number | undefined {
		return this.buffer[index];
	}

	/**
	 * Checks if the next char codes match the specified string
	 */
	match(str: string) {
		return this.buffer.indexOf(str, this.index) === this.index;
	}

	/**
	 * Advances the stream by one character
	 */
	advance() {
		if (this.index >= this.length) {
			throw new Error(`Cannot advance past the end of the stream`);
		} else if (this.buffer[this.index] === CHARS.NEWLINE) {
			this.index++;
			this.line++;
			this.column = 1;
		} else {
			this.index++;
			this.column++;
		}
	}

	skipWhitespace() {
		while (
			this.index < this.length &&
			(this.buffer[this.index] === CHARS.SPACE ||
				this.buffer[this.index] === CHARS.TAB ||
				this.buffer[this.index] === CHARS.NEWLINE)
		) {
			if (this.buffer[this.index] === CHARS.NEWLINE) {
				this.index++;
				this.line++;
				this.column = 1;
			} else {
				this.index++;
				this.column++;
			}
		}
	}

	advanceUntil(charCode: number) {
		while (this.index < this.length && this.buffer[this.index] !== charCode) {
			if (this.buffer[this.index] === CHARS.NEWLINE) {
				this.index++;
				this.line++;
				this.column = 1;
			} else {
				this.index++;
				this.column++;
			}
		}
	}

	/**
	 * Returns the next {@link count} char codes as a string
	 *
	 * Does not advance
	 */
	peek(count: number): string {
		return this.buffer.toString(`utf-8`, this.index, this.index + count);
	}

	/**
	 * Returns the index of the first char code to match the condition

	 * Does not advance
	 * @returns The index of the char code or undefined if no char code is found.
	 */
	seek(
		comparison: number | ((c?: number) => boolean),
		maxDistance = Infinity,
	): number | undefined {
		maxDistance = Math.min(this.index + maxDistance, this.length);
		if (typeof comparison === `function`) {
			for (let i = this.index; i < maxDistance; i++) {
				const c = this.buffer[i];
				if (comparison(c)) return i;
			}
		} else {
			for (let i = this.index; i < maxDistance; i++) {
				const c = this.buffer[i];
				if (c === comparison) return i;
			}
		}
	}

	/**
	 * Returns the stream index of the line specified
	 */
	lineNumberToIndex(lineNumber: number) {
		return this.lines[lineNumber - 1]?.index ?? -1;
	}
}

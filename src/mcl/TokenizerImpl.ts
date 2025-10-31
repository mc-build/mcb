import { StreamPosition, StringStream } from "./StringStream";

import {
	SyntaxPointerError,
	SyntaxPointerErrorOptions,
} from "./SyntaxPointerError";

interface BaseToken extends StreamPosition {
	type: keyof Tokens;
}

export const enum TOKEN_TYPE {
	/** A span of text. */
	SPAN,
	NEWLINE,

	COMMENT,
	MULTI_LINE_COMMENT,
	/** Minecraft's line continuation `' \'` */
	LINE_CONTINUATION,

	LEFT_CURLY_BRACKET,
	RIGHT_CURLY_BRACKET,
	LEFT_SQUARE_BRACKET,
	RIGHT_SQUARE_BRACKET,

	INLINE_SCRIPT,
	SCRIPT_BLOCK,
}

export interface Tokens {
	[TOKEN_TYPE.COMMENT]: BaseToken & { content: string };
	[TOKEN_TYPE.MULTI_LINE_COMMENT]: BaseToken & { content: string };
	[TOKEN_TYPE.LEFT_CURLY_BRACKET]: BaseToken;
	[TOKEN_TYPE.RIGHT_CURLY_BRACKET]: BaseToken;
	[TOKEN_TYPE.LEFT_SQUARE_BRACKET]: BaseToken;
	[TOKEN_TYPE.RIGHT_SQUARE_BRACKET]: BaseToken;
	[TOKEN_TYPE.INLINE_SCRIPT]: BaseToken & { content: string };
	[TOKEN_TYPE.SCRIPT_BLOCK]: BaseToken & { content: string };
	[TOKEN_TYPE.LINE_CONTINUATION]: BaseToken;
	[TOKEN_TYPE.NEWLINE]: BaseToken;
	[TOKEN_TYPE.SPAN]: BaseToken & { content: string };
}

export type Token = Tokens[keyof Tokens];

export const enum CHARS {
	NEWLINE = 10,
	SPACE = 32,
	TAB = 9,
	BACKSLASH = 92,
	LESS_THAN = 60,
	GREATER_THAN = 62,
	PERCENT = 37,
	HASH = 35,
	LEFT_SQUARE_BRACKET = 91,
	RIGHT_SQUARE_BRACKET = 93,
	LEFT_CURLY_BRACKET = 123,
	RIGHT_CURLY_BRACKET = 125,
}

export class Tokenizer extends StringStream {
	constructor(
		src: string,
		public srcFile: string,
	) {
		super(src.replace(/\r/g, ``));
	}

	throw(message: string, options?: SyntaxPointerErrorOptions): never {
		throw new SyntaxPointerError(message, this, options);
	}

	expected(toBe: string, description: string, butFound: string): never {
		throw new SyntaxPointerError(
			`Expected ${JSON.stringify(toBe)} ${description}, but found ${JSON.stringify(butFound)} instead`,
			this,
		);
	}

	skipInlineScriptContent(): void {
		while (
			this.index < this.length &&
			this.item !== CHARS.NEWLINE &&
			!(this.item === CHARS.PERCENT && this.next === CHARS.GREATER_THAN)
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

	skipScriptBlockContent(): void {
		while (
			this.index < this.length &&
			!(
				this.item === CHARS.PERCENT &&
				this.next === CHARS.PERCENT &&
				this.at(this.index + 2) === CHARS.GREATER_THAN
			)
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

	skipMultiLineCommentContent(): void {
		while (
			this.index < this.length &&
			!(
				this.item === CHARS.HASH &&
				this.next === CHARS.HASH &&
				this.at(this.index + 2) === CHARS.HASH
			)
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

	tokenize(): Token[] {
		const tokens: Token[] = [];

		let tokenStart = this.index;
		let tokenLine = this.line;
		let tokenColumn = this.column;

		while (this.index < this.length) {
			switch (this.item as number) {
				case CHARS.NEWLINE:
					if (tokenStart < this.index) {
						tokens.push({
							type: TOKEN_TYPE.SPAN,
							content: this.slice(tokenStart, this.index),
							line: tokenLine,
							column: tokenColumn,
						});
					}

					tokens.push({
						type: TOKEN_TYPE.NEWLINE,
						line: this.line,
						column: this.column,
					});
					this.skipWhitespace();
					break;

				case CHARS.SPACE:
					if (this.next !== CHARS.BACKSLASH) {
						this.advance(); // space
						continue; // Continue collecting span
					}
					// Line Continuation
					if (tokenStart < this.index) {
						tokens.push({
							type: TOKEN_TYPE.SPAN,
							content: this.slice(tokenStart, this.index),
							line: tokenLine,
							column: tokenColumn,
						});
					}

					tokens.push({
						type: TOKEN_TYPE.LINE_CONTINUATION,
						line: this.line,
						column: this.column,
					});
					this.advance(); // space
					this.advance(); // \

					if (this.index >= this.length) {
						this.expected(
							`\n`,
							`to end Line Continuation`,
							String.fromCharCode(this.item),
						);
					}
					this.skipWhitespace();
					break;

				case CHARS.HASH:
					// Require the start of the file or a new line before a comment
					if (this.index !== 0 && this.previous !== CHARS.NEWLINE) {
						this.advance(); // #
						continue; // Continue collecting span
					}

					tokenStart = this.index;
					tokenLine = this.line;
					tokenColumn = this.column;

					this.advance(); // #
					// Multi-line Comment
					if (this.item === CHARS.HASH && this.next === CHARS.HASH) {
						this.advance(); // #
						this.advance(); // #
						this.skipMultiLineCommentContent();
						if (this.index >= this.length) {
							this.expected(`###\n`, `to end Multi-line Comment`, `<EOF>`);
						}
						this.advance(); // #
						this.advance(); // #
						this.advance(); // #
						this.advance(); // \n
						tokens.push({
							type: TOKEN_TYPE.MULTI_LINE_COMMENT,
							content: this.slice(tokenStart, this.index),
							line: tokenLine,
							column: tokenColumn,
						});
					} else {
						// Single-line Comment
						this.advanceUntil(CHARS.NEWLINE);
						tokens.push({
							type: TOKEN_TYPE.COMMENT,
							content: this.slice(tokenStart, this.index),
							line: tokenLine,
							column: tokenColumn,
						});
					}
					this.skipWhitespace();
					break;

				case CHARS.LEFT_SQUARE_BRACKET:
					if (tokenStart < this.index) {
						tokens.push({
							type: TOKEN_TYPE.SPAN,
							content: this.slice(tokenStart, this.index),
							line: tokenLine,
							column: tokenColumn,
						});
					}
					tokens.push({
						type: TOKEN_TYPE.LEFT_SQUARE_BRACKET,
						line: this.line,
						column: this.column,
					});
					this.advance();
					break;

				case CHARS.RIGHT_SQUARE_BRACKET:
					if (tokenStart < this.index) {
						tokens.push({
							type: TOKEN_TYPE.SPAN,
							content: this.slice(tokenStart, this.index),
							line: tokenLine,
							column: tokenColumn,
						});
					}
					tokens.push({
						type: TOKEN_TYPE.RIGHT_SQUARE_BRACKET,
						line: this.line,
						column: this.column,
					});
					this.advance();
					break;

				case CHARS.LEFT_CURLY_BRACKET:
					if (tokenStart < this.index) {
						tokens.push({
							type: TOKEN_TYPE.SPAN,
							content: this.slice(tokenStart, this.index),
							line: tokenLine,
							column: tokenColumn,
						});
					}
					tokens.push({
						type: TOKEN_TYPE.LEFT_CURLY_BRACKET,
						line: this.line,
						column: this.column,
					});
					this.advance();
					break;

				case CHARS.RIGHT_CURLY_BRACKET:
					if (tokenStart < this.index) {
						tokens.push({
							type: TOKEN_TYPE.SPAN,
							content: this.slice(tokenStart, this.index),
							line: tokenLine,
							column: tokenColumn,
						});
					}
					tokens.push({
						type: TOKEN_TYPE.RIGHT_CURLY_BRACKET,
						line: this.line,
						column: this.column,
					});
					this.advance();
					break;

				case CHARS.LESS_THAN:
					if ((this.next as number) === CHARS.PERCENT) {
						if (tokenStart < this.index) {
							tokens.push({
								type: TOKEN_TYPE.SPAN,
								content: this.slice(tokenStart, this.index),
								line: tokenLine,
								column: tokenColumn,
							});
						}

						tokenLine = this.line;
						tokenColumn = this.column;

						this.advance(); // <
						this.advance(); // %

						// Multi-line JS Block
						if (this.item === CHARS.PERCENT) {
							this.advance(); // %
							tokenStart = this.index;
							this.skipScriptBlockContent();
							if (this.index >= this.length) {
								this.expected(`%%>`, `to end Multi-line JS Block`, `<EOF>`);
							}
							tokens.push({
								type: TOKEN_TYPE.SCRIPT_BLOCK,
								content: this.slice(tokenStart, this.index),
								line: tokenLine,
								column: tokenColumn,
							});
							this.advance(); // %
							this.advance(); // %
							this.advance(); // >
							break;
						}
						// Inline JS Block
						tokenStart = this.index;
						this.skipInlineScriptContent();
						if (this.index >= this.length) {
							this.expected(`%>`, `to end Inline JS Block`, `<EOF>`);
						} else if (this.item === CHARS.NEWLINE) {
							this.expected(`%>`, `to end Inline JS Block`, `\n`);
						}
						tokens.push({
							type: TOKEN_TYPE.INLINE_SCRIPT,
							content: this.slice(tokenStart, this.index),
							line: tokenLine,
							column: tokenColumn,
						});
						this.advance(); // %
						this.advance(); // >
						break;
					}
					// This is not the start of an inline/script block
					this.advance(); // <
					continue; // Continue collecting span

				default:
					this.advance();
					continue; // Continue collecting span
			}
			// We should only reach here if a non-span token was added.
			// So we should reset the span start position.
			tokenStart = this.index;
			tokenLine = this.line;
			tokenColumn = this.column;
		}

		if (tokenStart < this.index) {
			tokens.push({
				type: TOKEN_TYPE.SPAN,
				content: this.slice(tokenStart, this.index),
				line: tokenLine,
				column: tokenColumn,
			});
		}

		return tokens;
	}
}

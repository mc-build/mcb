import { StreamPosition, StringStream } from "./StringStream";

import {
	SyntaxPointerError,
	SyntaxPointerErrorOptions,
} from "./SyntaxPointerError";

interface BaseToken extends StreamPosition {
	type: TOKEN_TYPE;
}

export const enum TOKEN_TYPE {
	/** A span of text. */
	LITERAL,
	/** A group of spaces. */
	SPACE,
	LINE_BREAK,

	STRING,

	COMMENT,
	MULTI_LINE_COMMENT,
	/** Minecraft's line continuation `\` */
	LINE_CONTINUATION,

	OPEN_CURLY,
	CLOSE_CURLY,
	OPEN_SQUARE,
	CLOSE_SQUARE,
	OPEN_PARENTHESIS,
	CLOSE_PARENTHESIS,

	INLINE_SCRIPT,
	SCRIPT_BLOCK,
}

export interface Tokens {
	[TOKEN_TYPE.LITERAL]: BaseToken & {
		type: TOKEN_TYPE.LITERAL;
		content: string;
	};
	[TOKEN_TYPE.SPACE]: BaseToken & {
		type: TOKEN_TYPE.SPACE;
		count: number;
	};
	[TOKEN_TYPE.STRING]: BaseToken & {
		type: TOKEN_TYPE.STRING;
		quote: '"' | "'";
		content: string;
	};
	[TOKEN_TYPE.COMMENT]: BaseToken & {
		type: TOKEN_TYPE.COMMENT;
		content: string;
	};
	[TOKEN_TYPE.MULTI_LINE_COMMENT]: BaseToken & {
		type: TOKEN_TYPE.MULTI_LINE_COMMENT;
		content: string;
	};
	[TOKEN_TYPE.OPEN_CURLY]: BaseToken & {
		type: TOKEN_TYPE.OPEN_CURLY;
	};
	[TOKEN_TYPE.CLOSE_CURLY]: BaseToken & {
		type: TOKEN_TYPE.CLOSE_CURLY;
	};
	[TOKEN_TYPE.OPEN_SQUARE]: BaseToken & {
		type: TOKEN_TYPE.OPEN_SQUARE;
	};
	[TOKEN_TYPE.CLOSE_SQUARE]: BaseToken & {
		type: TOKEN_TYPE.CLOSE_SQUARE;
	};
	[TOKEN_TYPE.OPEN_PARENTHESIS]: BaseToken & {
		type: TOKEN_TYPE.OPEN_PARENTHESIS;
	};
	[TOKEN_TYPE.CLOSE_PARENTHESIS]: BaseToken & {
		type: TOKEN_TYPE.CLOSE_PARENTHESIS;
	};
	[TOKEN_TYPE.INLINE_SCRIPT]: BaseToken & {
		type: TOKEN_TYPE.INLINE_SCRIPT;
		script: string;
	};
	[TOKEN_TYPE.SCRIPT_BLOCK]: BaseToken & {
		type: TOKEN_TYPE.SCRIPT_BLOCK;
		script: string;
	};
	[TOKEN_TYPE.LINE_CONTINUATION]: BaseToken & {
		type: TOKEN_TYPE.LINE_CONTINUATION;
	};
	[TOKEN_TYPE.LINE_BREAK]: BaseToken & {
		type: TOKEN_TYPE.LINE_BREAK;
	};
}

export type Token = Tokens[TOKEN_TYPE];

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
	LEFT_PARENTHESIS = 40,
	RIGHT_PARENTHESIS = 41,
	DOUBLE_QUOTE = 34,
	SINGLE_QUOTE = 39,
}

export function getTokenTypeName(type: TOKEN_TYPE): string {
	switch (type) {
		case TOKEN_TYPE.LITERAL:
			return "Literal";
		case TOKEN_TYPE.SPACE:
			return "Space";
		case TOKEN_TYPE.STRING:
			return "String";
		case TOKEN_TYPE.COMMENT:
			return "Comment";
		case TOKEN_TYPE.MULTI_LINE_COMMENT:
			return "MultiLineComment";
		case TOKEN_TYPE.OPEN_CURLY:
			return "LeftCurlyBracket";
		case TOKEN_TYPE.CLOSE_CURLY:
			return "RightCurlyBracket";
		case TOKEN_TYPE.OPEN_SQUARE:
			return "LeftSquareBracket";
		case TOKEN_TYPE.CLOSE_SQUARE:
			return "RightSquareBracket";
		case TOKEN_TYPE.OPEN_PARENTHESIS:
			return "LeftParenthesis";
		case TOKEN_TYPE.CLOSE_PARENTHESIS:
			return "RightParenthesis";
		case TOKEN_TYPE.INLINE_SCRIPT:
			return "InlineScript";
		case TOKEN_TYPE.SCRIPT_BLOCK:
			return "ScriptBlock";
		case TOKEN_TYPE.LINE_CONTINUATION:
			return "LineContinuation";
		case TOKEN_TYPE.LINE_BREAK:
			return "Newline";
		default:
			return "Unknown";
	}
}

export function stringifyToken(token: Token): string {
	switch (token.type) {
		case TOKEN_TYPE.LITERAL:
			return token.content;
		case TOKEN_TYPE.SPACE:
			return " ".repeat(token.count);
		case TOKEN_TYPE.STRING:
			return `${token.quote}${token.content}${token.quote}`;
		case TOKEN_TYPE.COMMENT:
			return token.content;
		case TOKEN_TYPE.MULTI_LINE_COMMENT:
			return token.content;
		case TOKEN_TYPE.OPEN_CURLY:
			return "{";
		case TOKEN_TYPE.CLOSE_CURLY:
			return "}";
		case TOKEN_TYPE.OPEN_SQUARE:
			return "[";
		case TOKEN_TYPE.CLOSE_SQUARE:
			return "]";
		case TOKEN_TYPE.OPEN_PARENTHESIS:
			return "(";
		case TOKEN_TYPE.CLOSE_PARENTHESIS:
			return ")";
		case TOKEN_TYPE.INLINE_SCRIPT:
			return `<% ${token.script} %>`;
		case TOKEN_TYPE.SCRIPT_BLOCK:
			return `<%% ${token.script} %%>`;
		case TOKEN_TYPE.LINE_CONTINUATION:
			return `\\\n`;
		case TOKEN_TYPE.LINE_BREAK:
			return `\n`;
		default:
			throw new Error(`Unknown token type ${(token as any).type}`);
	}
}

export interface TokenizerResult {
	source: string;
	tokens: Token[];
}

export class Tokenizer extends StringStream {
	constructor(
		src: string,
		public srcFile: string,
	) {
		super(src.replace(/\r/g, ``));
	}

	throw(message: string, options?: SyntaxPointerErrorOptions): never {
		throw new SyntaxPointerError(
			message,
			this.buffer.toString(),
			this.line,
			this.column,
			options,
		);
	}

	expected(toBe: string, description: string, butFound: string): never {
		throw new SyntaxPointerError(
			`Expected ${JSON.stringify(toBe)} ${description}, but found ${JSON.stringify(butFound)} instead`,
			this.buffer.toString(),
			this.line,
			this.column,
		);
	}

	skipSpaces(): void {
		while (this.index < this.length && this.item === CHARS.SPACE) {
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
		if (this.index >= this.length) {
			this.expected(`%>`, `to end Inline Script`, `<EOF>`);
		} else if (this.item === CHARS.NEWLINE) {
			this.expected(`%>`, `to end Inline Script`, `\n`);
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
		if (this.index >= this.length) {
			this.expected(`%%>`, `to end Script Block`, `<EOF>`);
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
		if (this.index >= this.length) {
			this.expected(`###\n`, `to end Multi-line Comment`, `<EOF>`);
		}
	}

	skipStringContent(quoteChar: number): void {
		while (this.index < this.length && this.item !== quoteChar) {
			if (
				this.item === quoteChar &&
				this.buffer[this.index - 1] === CHARS.BACKSLASH
			) {
				this.index++;
				this.column++;
			} else if (
				this.buffer[this.index] === CHARS.LESS_THAN &&
				this.next === CHARS.PERCENT
			) {
				this.index += 2;
				this.column += 2;
				this.skipInlineScriptContent();
				this.index += 2;
				this.column += 2;
			} else if (this.buffer[this.index] === CHARS.NEWLINE) {
				this.index++;
				this.line++;
				this.column = 1;
			} else {
				this.index++;
				this.column++;
			}
		}
		if (this.index >= this.length) {
			this.expected(`'`, `to close string`, `<EOF>`);
		}
	}

	tokenize(): TokenizerResult {
		const tokens: Token[] = [];

		let tokenStart = this.index;
		let tokenLine = this.line;
		let tokenColumn = this.column;

		while (this.index < this.length) {
			switch (this.item as number) {
				case CHARS.NEWLINE:
					if (tokenStart < this.index) {
						tokens.push({
							type: TOKEN_TYPE.LITERAL,
							content: this.slice(tokenStart, this.index),
							line: tokenLine,
							column: tokenColumn,
						});
					}

					tokens.push({
						type: TOKEN_TYPE.LINE_BREAK,
						line: this.line,
						column: this.column,
					});
					this.skipWhitespace();
					break;

				case CHARS.SPACE:
					// Spaces always split spans
					if (tokenStart < this.index) {
						tokens.push({
							type: TOKEN_TYPE.LITERAL,
							content: this.slice(tokenStart, this.index),
							line: tokenLine,
							column: tokenColumn,
						});
					}

					tokenStart = this.index;
					tokenLine = this.line;
					tokenColumn = this.column;

					this.skipSpaces();

					tokens.push({
						type: TOKEN_TYPE.SPACE,
						count: this.index - tokenStart,
						line: tokenLine,
						column: tokenColumn,
					});
					break;

				case CHARS.BACKSLASH:
					if (this.next !== CHARS.NEWLINE) {
						this.advance(); // \
						continue; // Continue collecting span
					}

					tokens.push({
						type: TOKEN_TYPE.LINE_CONTINUATION,
						line: this.line,
						column: this.column,
					});
					this.advance(); // \
					this.skipWhitespace();
					break;

				case CHARS.HASH:
					// Require the start of the file or a new line before a comment
					if (
						this.index !== 0 &&
						tokens.at(-1)?.type !== TOKEN_TYPE.LINE_BREAK
					) {
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
						this.advance(); // #
						this.advance(); // #
						this.advance(); // #
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
					tokens.push({
						type: TOKEN_TYPE.LINE_BREAK,
						line: this.line,
						column: this.column,
					});
					this.skipWhitespace();
					break;

				case CHARS.LEFT_SQUARE_BRACKET:
					if (tokenStart < this.index) {
						tokens.push({
							type: TOKEN_TYPE.LITERAL,
							content: this.slice(tokenStart, this.index),
							line: tokenLine,
							column: tokenColumn,
						});
					}
					tokens.push({
						type: TOKEN_TYPE.OPEN_SQUARE,
						line: this.line,
						column: this.column,
					});
					this.advance();
					break;

				case CHARS.RIGHT_SQUARE_BRACKET:
					if (tokenStart < this.index) {
						tokens.push({
							type: TOKEN_TYPE.LITERAL,
							content: this.slice(tokenStart, this.index),
							line: tokenLine,
							column: tokenColumn,
						});
					}
					tokens.push({
						type: TOKEN_TYPE.CLOSE_SQUARE,
						line: this.line,
						column: this.column,
					});
					this.advance();
					break;

				case CHARS.LEFT_CURLY_BRACKET:
					if (tokenStart < this.index) {
						tokens.push({
							type: TOKEN_TYPE.LITERAL,
							content: this.slice(tokenStart, this.index),
							line: tokenLine,
							column: tokenColumn,
						});
					}
					tokens.push({
						type: TOKEN_TYPE.OPEN_CURLY,
						line: this.line,
						column: this.column,
					});
					this.advance();
					break;

				case CHARS.RIGHT_CURLY_BRACKET:
					if (tokenStart < this.index) {
						tokens.push({
							type: TOKEN_TYPE.LITERAL,
							content: this.slice(tokenStart, this.index),
							line: tokenLine,
							column: tokenColumn,
						});
					}
					tokens.push({
						type: TOKEN_TYPE.CLOSE_CURLY,
						line: this.line,
						column: this.column,
					});
					this.advance();
					break;

				case CHARS.LEFT_PARENTHESIS:
					if (tokenStart < this.index) {
						tokens.push({
							type: TOKEN_TYPE.LITERAL,
							content: this.slice(tokenStart, this.index),
							line: tokenLine,
							column: tokenColumn,
						});
					}
					tokens.push({
						type: TOKEN_TYPE.OPEN_PARENTHESIS,
						line: this.line,
						column: this.column,
					});
					this.advance();
					break;

				case CHARS.RIGHT_PARENTHESIS:
					if (tokenStart < this.index) {
						tokens.push({
							type: TOKEN_TYPE.LITERAL,
							content: this.slice(tokenStart, this.index),
							line: tokenLine,
							column: tokenColumn,
						});
					}
					tokens.push({
						type: TOKEN_TYPE.CLOSE_PARENTHESIS,
						line: this.line,
						column: this.column,
					});
					this.advance();
					break;

				case CHARS.DOUBLE_QUOTE:
					if (tokenStart < this.index) {
						tokens.push({
							type: TOKEN_TYPE.LITERAL,
							content: this.slice(tokenStart, this.index),
							line: tokenLine,
							column: tokenColumn,
						});
					}

					tokenStart = this.index;
					tokenLine = this.line;
					tokenColumn = this.column;

					this.advance(); // "
					this.skipStringContent(CHARS.DOUBLE_QUOTE);
					tokens.push({
						type: TOKEN_TYPE.STRING,
						content: this.slice(tokenStart + 1, this.index),
						quote: `"`,
						line: tokenLine,
						column: tokenColumn,
					});
					this.advance(); // "
					break;

				case CHARS.SINGLE_QUOTE:
					if (tokenStart < this.index) {
						tokens.push({
							type: TOKEN_TYPE.LITERAL,
							content: this.slice(tokenStart, this.index),
							line: tokenLine,
							column: tokenColumn,
						});
					}

					tokenStart = this.index;
					tokenLine = this.line;
					tokenColumn = this.column;

					this.advance(); // '
					this.skipStringContent(CHARS.SINGLE_QUOTE);
					tokens.push({
						type: TOKEN_TYPE.STRING,
						content: this.slice(tokenStart + 1, this.index),
						quote: `'`,
						line: tokenLine,
						column: tokenColumn,
					});
					this.advance(); // '
					break;

				case CHARS.LESS_THAN:
					if ((this.next as number) === CHARS.PERCENT) {
						if (tokenStart < this.index) {
							tokens.push({
								type: TOKEN_TYPE.LITERAL,
								content: this.slice(tokenStart, this.index),
								line: tokenLine,
								column: tokenColumn,
							});
						}

						tokenLine = this.line;
						tokenColumn = this.column;

						this.advance(); // <
						this.advance(); // %

						// Multi-line Script Block
						if (this.item === CHARS.PERCENT) {
							this.advance(); // %
							tokenStart = this.index;
							this.skipScriptBlockContent();
							tokens.push({
								type: TOKEN_TYPE.SCRIPT_BLOCK,
								script: this.slice(tokenStart, this.index),
								line: tokenLine,
								column: tokenColumn,
							});
							this.advance(); // %
							this.advance(); // %
							this.advance(); // >
							break;
						}
						// Inline Script
						tokenStart = this.index;
						this.skipInlineScriptContent();
						tokens.push({
							type: TOKEN_TYPE.INLINE_SCRIPT,
							script: this.slice(tokenStart, this.index),
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
				type: TOKEN_TYPE.LITERAL,
				content: this.slice(tokenStart, this.index),
				line: tokenLine,
				column: tokenColumn,
			});
		}

		return {
			source: this.buffer.toString(),
			tokens,
		};
	}
}

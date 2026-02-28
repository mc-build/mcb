import { Token } from "./Tokenizer";

export class TokenSequence {
	index = 0;
	readonly tokens: Token[];

	slice: (start: number, end?: number) => Token[];

	constructor(tokens: Token[]) {
		this.tokens = tokens;
		this.slice = this.tokens.slice.bind(this.tokens);
	}

	get previous(): Token {
		return this.tokens[this.index - 1];
	}

	get item(): Token {
		return this.tokens[this.index];
	}

	get next(): Token {
		return this.tokens[this.index + 1];
	}

	get length(): number {
		return this.tokens.length;
	}
}

export interface PosInfo {
	line: number;
	col: number;
	file: string;
}

/** `raw` is the full source line the token came from, without indentation. */
export type Token =
	| { type: "Literal"; v: string; pos: PosInfo; raw?: string }
	| { type: "BracketOpen"; pos: PosInfo; data?: string; raw?: string }
	| { type: "BracketClose"; pos: PosInfo; raw?: string };

export enum TokenIds {
	Literal = 0,
	BracketOpen = 1,
	BracketClose = 2,
}

export enum Brackets {
	Curly,
	Square,
	Round,
}

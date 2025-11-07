export interface PosInfo {
	line: number;
	col: number;
	file: string;
}

export type Token =
	| { type: "Literal"; v: string; pos: PosInfo }
	| { type: "BracketOpen"; pos: PosInfo; data?: string }
	| { type: "BracketClose"; pos: PosInfo };

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

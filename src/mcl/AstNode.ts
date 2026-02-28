import { StreamPosition } from "./StringStream";
import { Token, TOKEN_TYPE, Tokens } from "./Tokenizer";

export type JsonTagType =
	| { kind: "Tag"; subType: string; replace: boolean; entries: AstNode[] }
	| { kind: "Advancement"; entries: AstNode[] }
	| { kind: "ItemModifier"; entries: AstNode[] }
	| { kind: "LootTable"; entries: AstNode[] }
	| { kind: "Predicate"; entries: AstNode[] }
	| { kind: "Recipe"; entries: AstNode[] }
	| { kind: "ChatType"; entries: AstNode[] }
	| { kind: "DamageType"; entries: AstNode[] }
	| { kind: "Dimension"; entries: AstNode[] }
	| { kind: "DimensionType"; entries: AstNode[] }
	| { kind: "Enchantment"; entries: AstNode[] }
	| { kind: "WorldGen"; subType: string; name: string; entries: AstNode[] };

export const enum AST_NODE_TYPE {
	LITERAL,
	COMMAND,
	COMMENT,
	FUNCTION_DEF,
	TEMPLATE_DEF,
	FOLDER_DEF,
	IMPORT,
	COMPILE_TIME_REPEAT,
	COMPILE_TIME_IF,
	INLINE_SCRIPT,
	SCRIPT_BLOCK,
	BLOCK,
	TICK_BLOCK,
	LOAD_BLOCK,
	SCHEDULE_CALL,
	SCHEDULE_BLOCK,
	SEQUENCE_BLOCK,
	JSON_FILE,
	CLOCK,
	EXECUTE_RUN_CHAIN,
	EXECUTE_IF_UNLESS_FUNCTION,
	CONDITIONAL_BLOCK,
	FUNCTION_CALL,
	EQ,
	RETURN_RUN,
}

interface BaseAstNode extends StreamPosition {
	type: AST_NODE_TYPE;
}

export interface CompileTimeIfElseExpression {
	condition?: Token[];
	body: AstNode[];
}

export interface AstNodes {
	[AST_NODE_TYPE.LITERAL]: BaseAstNode & {
		type: AST_NODE_TYPE.LITERAL;
		tokens: Token[];
	};
	[AST_NODE_TYPE.COMMAND]: BaseAstNode & {
		type: AST_NODE_TYPE.COMMAND;
		tokens: Token[];
	};
	[AST_NODE_TYPE.FUNCTION_DEF]: BaseAstNode & {
		type: AST_NODE_TYPE.FUNCTION_DEF;
		name: AstNodes[AST_NODE_TYPE.LITERAL];
		tag?: AstNodes[AST_NODE_TYPE.LITERAL];
		body: AstNode[];
	};
	[AST_NODE_TYPE.TEMPLATE_DEF]: BaseAstNode & {
		type: AST_NODE_TYPE.TEMPLATE_DEF;
	};
	[AST_NODE_TYPE.FOLDER_DEF]: BaseAstNode & {
		type: AST_NODE_TYPE.FOLDER_DEF;
		name: AstNodes[AST_NODE_TYPE.LITERAL];
		body: AstNode[];
	};
	[AST_NODE_TYPE.IMPORT]: BaseAstNode & {
		type: AST_NODE_TYPE.IMPORT;
		path: AstNodes[AST_NODE_TYPE.LITERAL];
	};
	[AST_NODE_TYPE.COMPILE_TIME_REPEAT]: BaseAstNode & {
		type: AST_NODE_TYPE.COMPILE_TIME_REPEAT;
		expression: Token[];
		varName?: AstNodes[AST_NODE_TYPE.LITERAL];
		body: AstNode[];
	};
	[AST_NODE_TYPE.COMPILE_TIME_IF]: BaseAstNode & {
		type: AST_NODE_TYPE.COMPILE_TIME_IF;
		condition: Token[];
		body: AstNode[];
		elseExpressions?: CompileTimeIfElseExpression[];
	};
	[AST_NODE_TYPE.INLINE_SCRIPT]: BaseAstNode & {
		type: AST_NODE_TYPE.INLINE_SCRIPT;
		script: string;
	};
	[AST_NODE_TYPE.SCRIPT_BLOCK]: BaseAstNode & {
		type: AST_NODE_TYPE.SCRIPT_BLOCK;
		script: string;
	};
	[AST_NODE_TYPE.BLOCK]: BaseAstNode & {
		type: AST_NODE_TYPE.BLOCK;
		name?: AstNodes[AST_NODE_TYPE.LITERAL];
		args?: Token[];
		body: AstNode[];
	};
	[AST_NODE_TYPE.TICK_BLOCK]: BaseAstNode & {
		type: AST_NODE_TYPE.TICK_BLOCK;
	};
	[AST_NODE_TYPE.LOAD_BLOCK]: BaseAstNode & {
		type: AST_NODE_TYPE.LOAD_BLOCK;
	};
	[AST_NODE_TYPE.SCHEDULE_BLOCK]: BaseAstNode & {
		type: AST_NODE_TYPE.SCHEDULE_BLOCK;
		delay: AstNodes[AST_NODE_TYPE.LITERAL];
		mode?: "replace" | "append";
		block: AstNodes[AST_NODE_TYPE.BLOCK];
	};
	[AST_NODE_TYPE.SEQUENCE_BLOCK]: BaseAstNode & {
		type: AST_NODE_TYPE.SEQUENCE_BLOCK;
	};
	[AST_NODE_TYPE.COMMENT]: BaseAstNode & {
		type: AST_NODE_TYPE.COMMENT;
	};
	[AST_NODE_TYPE.JSON_FILE]: BaseAstNode & {
		type: AST_NODE_TYPE.JSON_FILE;
		name: AstNodes[AST_NODE_TYPE.LITERAL];
		path: AstNodes[AST_NODE_TYPE.LITERAL];
		body: AstNode[];
	};
	[AST_NODE_TYPE.CLOCK]: BaseAstNode & {
		type: AST_NODE_TYPE.CLOCK;
		name: AstNodes[AST_NODE_TYPE.LITERAL];
		time: AstNodes[AST_NODE_TYPE.LITERAL];
		body: AstNode[];
	};
	[AST_NODE_TYPE.EXECUTE_RUN_CHAIN]: BaseAstNode & {
		type: AST_NODE_TYPE.EXECUTE_RUN_CHAIN;
		blocks: AstNodes[AST_NODE_TYPE.CONDITIONAL_BLOCK][];
	};
	[AST_NODE_TYPE.EXECUTE_IF_UNLESS_FUNCTION]: BaseAstNode & {
		type: AST_NODE_TYPE.EXECUTE_IF_UNLESS_FUNCTION;
		mode: "if" | "unless";
		block: AstNodes[AST_NODE_TYPE.BLOCK];
	};
	[AST_NODE_TYPE.CONDITIONAL_BLOCK]: BaseAstNode & {
		condition?: AstNode[];
		block: AstNodes[AST_NODE_TYPE.BLOCK];
	};
	[AST_NODE_TYPE.FUNCTION_CALL]: BaseAstNode & {
		type: AST_NODE_TYPE.FUNCTION_CALL;
		mode: "absolute" | "relative" | "hiarchical" | "root";
		path: AstNodes[AST_NODE_TYPE.LITERAL];
		args?: Token[];
	};
	[AST_NODE_TYPE.EQ]: BaseAstNode & {
		type: AST_NODE_TYPE.EQ;
	};
	[AST_NODE_TYPE.SCHEDULE_CALL]: BaseAstNode & {
		type: AST_NODE_TYPE.SCHEDULE_CALL;
		name: AstNodes[AST_NODE_TYPE.LITERAL];
		delay: AstNodes[AST_NODE_TYPE.LITERAL];
		mode?: "replace" | "append";
	};

	[AST_NODE_TYPE.RETURN_RUN]: BaseAstNode & {
		type: AST_NODE_TYPE.RETURN_RUN;
	};
}

export type AstNode = AstNodes[AST_NODE_TYPE];

export type LiteralOrInlineScript =
	| AstNodes[AST_NODE_TYPE.COMMAND]
	| AstNodes[AST_NODE_TYPE.INLINE_SCRIPT];

export function getAstNodeTypeName(type: AST_NODE_TYPE): string {
	switch (type) {
		case AST_NODE_TYPE.COMMAND:
			return "Raw";
		case AST_NODE_TYPE.FUNCTION_DEF:
			return "FunctionDef";
		case AST_NODE_TYPE.TEMPLATE_DEF:
			return "TemplateDef";
		case AST_NODE_TYPE.FOLDER_DEF:
			return "Directory";
		case AST_NODE_TYPE.IMPORT:
			return "Import";
		case AST_NODE_TYPE.COMPILE_TIME_REPEAT:
			return "CompileTimeLoop";
		case AST_NODE_TYPE.COMPILE_TIME_IF:
			return "CompileTimeIf";
		case AST_NODE_TYPE.INLINE_SCRIPT:
			return "InlineScript";
		case AST_NODE_TYPE.SCRIPT_BLOCK:
			return "ScriptBlock";
		case AST_NODE_TYPE.BLOCK:
			return "Block";
		case AST_NODE_TYPE.TICK_BLOCK:
			return "TickBlock";
		case AST_NODE_TYPE.LOAD_BLOCK:
			return "LoadBlock";
		case AST_NODE_TYPE.SCHEDULE_BLOCK:
			return "ScheduleBlock";
		case AST_NODE_TYPE.SEQUENCE_BLOCK:
			return "SequenceBlock";
		case AST_NODE_TYPE.COMMENT:
			return "Comment";
		case AST_NODE_TYPE.JSON_FILE:
			return "JsonFile";
		case AST_NODE_TYPE.CLOCK:
			return "ClockExpr";
		case AST_NODE_TYPE.EXECUTE_RUN_CHAIN:
			return "Execute";
		case AST_NODE_TYPE.FUNCTION_CALL:
			return "FunctionCall";
		case AST_NODE_TYPE.EQ:
			return "Eq";
		case AST_NODE_TYPE.SCHEDULE_CALL:
			return "ScheduleCall";
		case AST_NODE_TYPE.RETURN_RUN:
			return "ReturnRun";
		default:
			return "Unknown";
	}
}

// export type AstNode =
// 	| {
// 			type: "Raw";
// 			pos: PosInfo;
// 			value: string;
// 			continuations?: AstNode[] | null;
// 			isMacro?: boolean;
// 	  }
// 	| {
// 			type: "FunctionDef";
// 			pos: PosInfo;
// 			name: string;
// 			body: AstNode[];
// 			appendTo?: string | null;
// 	  }
// 	| { type: "TemplateDef"; pos: PosInfo; name: string; body: AstNode[] }
// 	| { type: "Directory"; pos: PosInfo; name: string; body: AstNode[] }
// 	| { type: "Import"; pos: PosInfo; name: string }
// 	| {
// 			type: "CompileTimeLoop";
// 			pos: PosInfo;
// 			expression: string;
// 			as?: string[] | null;
// 			body: AstNode[];
// 	  }
// 	| {
// 			type: "CompileTimeIf";
// 			pos: PosInfo;
// 			expression: string;
// 			body: AstNode[];
// 			elseExpressions: CompileTimeIfElseExpressions;
// 	  }
// 	| { type: "MultiLineScript"; pos: PosInfo; value: Token[] }
// 	| {
// 			type: "Block";
// 			pos: PosInfo;
// 			name?: string | null;
// 			body: AstNode[];
// 			data?: string | null;
// 			isMacro?: boolean;
// 			isInline?: boolean;
// 	  }
// 	| { type: "TickBlock"; pos: PosInfo; body: AstNode[] }
// 	| { type: "LoadBlock"; pos: PosInfo; body: AstNode[] }
// 	| {
// 			type: "ExecuteBlock";
// 			pos: PosInfo;
// 			execute: string;
// 			data?: string | null;
// 			body: AstNode[];
// 			continuations?: AstNode[] | null;
// 			isMacro?: boolean;
// 	  }
// 	| {
// 			type: "ScheduleBlock";
// 			pos: PosInfo;
// 			delay: string;
// 			blockType: string;
// 			body: AstNode[];
// 			isMacro?: boolean;
// 	  }
// 	| { type: "SequenceBlock"; pos: PosInfo; body: AstNode[] }
// 	| { type: "RuntimeLoop"; pos: PosInfo; expression: string; body: AstNode[] }
// 	| { type: "Comment"; pos: PosInfo; value: string }
// 	| { type: "JsonFile"; pos: PosInfo; name: string; info: JsonTagType }
// 	| { type: "TemplateOverload"; pos: PosInfo; args: string; body: AstNode[] }
// 	| {
// 			type: "ClockExpr";
// 			pos: PosInfo;
// 			name: string;
// 			time: string;
// 			body: AstNode[];
// 	  }
// 	| {
// 			type: "Execute";
// 			pos: PosInfo;
// 			command: string;
// 			value: AstNode;
// 			isMacro?: boolean;
// 	  }
// 	| {
// 			type: "FunctionCall";
// 			pos: PosInfo;
// 			name: string;
// 			data: string;
// 			isMacro?: boolean;
// 	  }
// 	| { type: "EqCommand"; pos: PosInfo; command: string }
// 	| {
// 			type: "ScheduleCall";
// 			pos: PosInfo;
// 			delay: string;
// 			target: string;
// 			mode: string;
// 			isMacro?: boolean;
// 	  }
// 	| { type: "ReturnRun"; pos: PosInfo; value: AstNode; isMacro?: boolean }
// 	| { type: "ScheduleClear"; pos: PosInfo; target: string; isMacro?: boolean }
// 	| { type: "Void" }
// 	| { type: "Group"; body: AstNode[] };

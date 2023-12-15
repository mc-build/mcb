package mcl;

import mcl.Tokenizer.Token;
import mcl.Tokenizer.PosInfo;

enum JsonTagType {
	Blocks;
	Loot;
}

typedef CompileTimeIfElseExpressions = Array<{condition:Null<String>, node:Array<AstNode>}>;

enum AstNode {
	Raw(pos:PosInfo, value:String, continuations:Null<Array<AstNode>>);

	// tld definitions
	FunctionDef(pos:PosInfo, name:String, body:Array<AstNode>, appendTo:Null<String>);
	TemplateDef(pos:PosInfo, name:String, body:Array<AstNode>);
	Directory(pos:PosInfo, name:String, body:Array<AstNode>);

	// compile time expressions
	Import(pos:PosInfo, name:String);
	CompileTimeLoop(pos:PosInfo, expression:String, as:String, body:Array<AstNode>);
	CompileTimeIf(pos:PosInfo, expression:String, body:Array<AstNode>, elseExpressions:CompileTimeIfElseExpressions);
	MultiLineScript(pos:PosInfo, value:Array<Token>);

	// block
	Block(pos:PosInfo, name:Null<String>, body:Array<AstNode>, data:Null<String>);
	TickBlock(pos:PosInfo, body:Array<AstNode>);
	LoadBlock(pos:PosInfo, body:Array<AstNode>);

	// syntax sugar
	ExecuteBlock(pos:PosInfo, execute:String, data:Null<String>, body:Array<AstNode>, ?continuations:Null<Array<AstNode>>);
	ScheduleBlock(pos:PosInfo, delay:String, type:String, body:Array<AstNode>);
	SequenceBlock(pos:PosInfo, body:Array<AstNode>);

	// runtime expressions
	RuntimeLoop(pos:PosInfo, expression:String, body:Array<AstNode>);
	Comment(pos:PosInfo, value:String);

	// json tags
	JsonFile(pos:PosInfo, name:String, type:JsonTagType, body:Array<AstNode>);
	JsonTag(pos:PosInfo, name:String, type:JsonTagType, value:Array<AstNode>);

	// template expressions
	TemplateOverload(pos:PosInfo, args:String, body:Array<AstNode>);

	ClockExpr(pos:PosInfo, time:String, body:Array<AstNode>);

	Execute(pos:PosInfo, command:String, value:AstNode);

	FunctionCall(pos:PosInfo, name:String, data:String);
}

class AstNodeUtils {
	public static inline function getPos(n:AstNode):PosInfo {
		return untyped n.pos;
	}
}

enum abstract AstNodeIds(Int) from Int {
	var Raw = 0;

	// tld definitions
	var FunctionDef = 1;
	var TemplateDef = 2;
	var Directory = 3;

	// compile time expressions
	var Import = 4;
	var CompileTimeLoop = 5;
	var CompileTimeIf = 6;
	var MultiLineScript = 7;

	// block
	var Block = 8;
	var TickBlock = 9;
	var LoadBlock = 10;

	// syntax sugar
	var ExecuteBlock = 11;
	var ScheduleBlock = 12;
	var SequenceBlock = 13;

	// runtime expressions
	var RuntimeLoop = 14;
	var Comment = 16;

	// json tags
	var JsonFile = 17;
	var JsonTag = 18;

	// clock
	var ClockExpr = 19;

	// Additions
	var Execute = 20;

	var FunctionCall = 21;
}

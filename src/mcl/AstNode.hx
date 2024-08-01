package mcl;

import mcl.Tokenizer.Token;
import mcl.Tokenizer.PosInfo;

enum JsonTagType {
	Tag(subType:String, replace:Bool, entries:Array<AstNode>);
	Advancement(entries:Array<AstNode>);
	ItemModifier(entries:Array<AstNode>);
	LootTable(entries:Array<AstNode>);
	Predicate(entries:Array<AstNode>);
	Recipe(entries:Array<AstNode>);
	ChatType(entries:Array<AstNode>);
	DamageType(entries:Array<AstNode>);
	Dimension(entries:Array<AstNode>);
	DimensionType(entries:Array<AstNode>);
	Enchantment(entries:Array<AstNode>);
	WorldGen(subType:String, name:String, entries:Array<AstNode>);
}

typedef CompileTimeIfElseExpressions = Array<{condition:Null<String>, node:Array<AstNode>}>;

enum AstNode {
	Raw(pos:PosInfo, value:String, continuations:Null<Array<AstNode>>, isMacro:Bool);

	// tld definitions
	FunctionDef(pos:PosInfo, name:String, body:Array<AstNode>, appendTo:Null<String>);
	TemplateDef(pos:PosInfo, name:String, body:Array<AstNode>);
	Directory(pos:PosInfo, name:String, body:Array<AstNode>);

	// compile time expressions
	Import(pos:PosInfo, name:String);
	CompileTimeLoop(pos:PosInfo, expression:String, as:Null<Array<String>>, body:Array<AstNode>);
	CompileTimeIf(pos:PosInfo, expression:String, body:Array<AstNode>, elseExpressions:CompileTimeIfElseExpressions);
	MultiLineScript(pos:PosInfo, value:Array<Token>);

	// block
	Block(pos:PosInfo, name:Null<String>, body:Array<AstNode>, data:Null<String>, isMacro:Bool, isInline:Bool);
	TickBlock(pos:PosInfo, body:Array<AstNode>);
	LoadBlock(pos:PosInfo, body:Array<AstNode>);

	// syntax sugar
	ExecuteBlock(pos:PosInfo, execute:String, data:Null<String>, body:Array<AstNode>, ?continuations:Null<Array<AstNode>>, isMacro:Bool);
	ScheduleBlock(pos:PosInfo, delay:String, type:String, body:Array<AstNode>, isMacro:Bool);
	SequenceBlock(pos:PosInfo, body:Array<AstNode>);

	// runtime expressions
	RuntimeLoop(pos:PosInfo, expression:String, body:Array<AstNode>);
	Comment(pos:PosInfo, value:String);

	// json tags
	JsonFile(pos:PosInfo, name:String, info:JsonTagType);
	// template expressions
	TemplateOverload(pos:PosInfo, args:String, body:Array<AstNode>);

	ClockExpr(pos:PosInfo, name:String, time:String, body:Array<AstNode>);

	Execute(pos:PosInfo, command:String, value:AstNode, isMacro:Bool);

	FunctionCall(pos:PosInfo, name:String, data:String, isMacro:Bool);

	EqCommand(pos:PosInfo, command:String);

	ScheduleCall(pos:PosInfo, delay:String, target:String, mode:String, isMacro:Bool);

	ReturnRun(pos:PosInfo, value:AstNode, isMacro:Bool);

	ScheduleClear(pos:PosInfo, target:String, isMacro:Bool);

	// internal nodes
	Void;
	Group(body:Array<AstNode>);
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

	// clock
	var ClockExpr = 19;

	// Additions
	var Execute = 20;

	var FunctionCall = 21;

	var EqCommand = 22;

	var ScheduleCall = 23;

	var ReturnRun = 24;
}

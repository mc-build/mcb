package mcl;

import mcl.Tokenizer.Token;
import mcl.Tokenizer.PosInfo;

enum JsonTagType {
	Blocks;
	Loot;
}

enum AstNode {
	Raw(pos:PosInfo, value:String);

	// tld definitions
	FunctionDef(pos:PosInfo, name:String, body:Array<AstNode>);
	MacroDef(pos:PosInfo, name:String, body:Array<AstNode>);
	Directory(pos:PosInfo, name:String, body:Array<AstNode>);

	// compile time expressions
	Import(pos:PosInfo, name:String);
	CompileTimeLoop(pos:PosInfo, expression:String, as:String, body:Array<AstNode>);
	CompileTimeIf(pos:PosInfo, expression:String, body:Array<AstNode>, elseExpression:Null<Array<AstNode>>);
	MultiLineScript(pos:PosInfo, value:Array<Token>);

	// block
	Block(pos:PosInfo, body:Array<AstNode>, data:Null<String>);

	// syntax sugar
	ExecuteBlock(pos:PosInfo, execute:String, data:Null<String>, body:Array<AstNode>);
	ScheduleBlock(pos:PosInfo, delay:String, type:String, body:Array<AstNode>);

	// runtime expressions
	RuntimeLoop(pos:PosInfo, expression:String, body:Array<AstNode>);
	RuntimeIf(pos:PosInfo, expression:String, body:Array<AstNode>, elseExpression:Null<Array<AstNode>>);
	Comment(pos:PosInfo, value:String);

	// json tags
	JsonFile(pos:PosInfo, name:String, type:JsonTagType, body:Array<AstNode>);
	JsonTag(pos:PosInfo, name:String, type:JsonTagType, value:Array<AstNode>);
}

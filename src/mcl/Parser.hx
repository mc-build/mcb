package mcl;

import mcl.Tokenizer.Brackets;
import js.Lib;
import js.Syntax;
import mcl.Tokenizer.PosInfo;
import mcl.AstNode.JsonTagType;
import haxe.macro.Context;
import MinificationHelper.Minified;
import haxe.extern.Rest;
import mcl.Tokenizer.TokenIds;
import mcl.Tokenizer.Token;

private class ArrayInput<T> implements Minified {
	var array:Array<T>;
	var index:Int;

	public function new(array:Array<T>) {
		this.array = array;
		this.index = 0;
	}

	public function next():T {
		return array[index++];
	}

	public function peek():T {
		return array[index];
	}

	public function hasNext():Bool {
		return index < array.length;
	}
}

typedef TokenInput = ArrayInput<Token>;

enum abstract Errors(String) from String to String {
	var UnexpectedTokenLiteral = "Unexpected token '{}' at {}:{}:{}";
	var UnexpectedTokenBracketOpen = "Unexpected '{' with data '{}' at {}:{}:{}";
	var UnexpectedTokenBracketClose = "Unexpected '}' at {}:{}:{}";

	var ErrorWhilstEvaluatingExpression = "Error whilst evaluating expression: '{}' at {}:{}:{}";
}

class Parser {
	public static function format(template:String, data:Rest<Dynamic>):String {
		var regex = new EReg("\\{\\}", "");
		for (field in data.toArray()) {
			template = regex.replace(template, Std.string(field));
		}
		return template;
	}

	public static function toss(token:Token, error:String) {
		switch (token) {
			case Literal(v, pos):
				throw format(error, v, pos.file, pos.line, pos.col);
			case BracketOpen(pos, data):
				throw format(error, data, pos.file, pos.line, pos.col);
			case BracketClose(pos):
				throw format(error, pos.file, pos.line, pos.col);
		}
	}

	private static function unreachable(token:Token) {
		return switch (token) {
			case Literal(v, p): format(Errors.UnexpectedTokenLiteral, v, p.file, p.line, p.col);
			case BracketOpen(p, d): format(Errors.UnexpectedTokenBracketOpen, d, p.file, p.line, p.col);
			case BracketClose(p): format(Errors.UnexpectedTokenBracketClose, p.file, p.line, p.col);
		}
	}

	private static function expect(reader:TokenInput, match:(v:Token) -> Bool) {
		var token = reader.next();
		if (!match(token)) {
			throw unreachable(token);
		}
	}

	private static function expectThenData(reader:TokenInput, allowData:Bool = true) {
		var token = reader.peek();
		expect(reader, function(token) return Type.enumIndex(token) == TokenIds.BracketOpen);
		return switch (token) {
			case BracketOpen(_, data):
				if (!allowData && data.length > 0)
					throw unreachable(token);
				data;
			default: null;
		}
	}

	private static function block(reader:TokenInput, sub:Void->Void, allowData:Bool = true):Null<String> {
		var data = expectThenData(reader, allowData);
		while (true) {
			var token = reader.peek();
			switch (token) {
				case BracketClose(_):
					break;
				default:
					sub();
			}
		}
		expect(reader, function(token) return Type.enumIndex(token) == TokenIds.BracketClose);
		return data == '' ? null : data;
	}

	private static function readFunction(name:String, reader:TokenInput, pos:PosInfo, isMacro:Bool = false):AstNode {
		// expect(reader, function(token) return Type.enumIndex(token) == TokenIds.BracketOpen);
		var commands:Array<AstNode> = [];
		block(reader, () -> {
			commands.push(innerParse(reader));
		}, false);
		if (isMacro)
			return MacroDef(pos, name, commands);
		return FunctionDef(pos, name, commands);
	}

	private static function pos(token:Token):PosInfo {
		return switch (token) {
			case Literal(_, pos) | BracketOpen(pos, _) | BracketClose(pos):
				pos;
		}
	}

	private static function json(reader:TokenInput):AstNode {
		var pos = pos(reader.peek());
		var depth = 0;

		var result = "";
		do {
			var token = reader.next();
			switch (token) {
				case BracketOpen(_, data):
					result += "{";
					result += data;
					depth++;
				case BracketClose(_):
					depth--;
					result += "}";
				case Literal(v, _):
					result += v;
			}
		} while (depth > 0);
		return Raw(pos, result);
	}

	public static function parseMcbFile(tokens:Array<Token>):Array<AstNode> {
		var reader = new TokenInput(tokens);
		var nodes:Array<AstNode> = [];
		while (reader.hasNext()) {
			nodes.push(parseTLD(reader));
		}
		return nodes;
	}

	public static function parseMcbmFile(tokens:Array<Token>):Array<AstNode> {
		var reader = new TokenInput(tokens);
		var nodes:Array<AstNode> = [];
		while (reader.hasNext()) {
			var token = reader.next();
			nodes.push(switch (token) {
				case Literal(v, pos):
					switch (v) {
						case _ if (StringTools.startsWith(v, "macro ")):
							var name = StringTools.trim(v.substring("macro ".length));
							readFunction(name, reader, pos, true);
						case _ if (StringTools.startsWith(v, "#")):
							Comment(pos, v);
						default:
							throw unreachable(token);
					}
				default:
					throw unreachable(token);
			});
		}
		return nodes;
	}

	public static function parserCompilerLoop(v:String, pos:PosInfo, reader:TokenInput, handler:Void->AstNode):AstNode {
		var content:Array<AstNode> = [];
		block(reader, () -> {
			content.push(handler());
		});
		// a regex that matches LOOP(.+?)followed by an optional as [a-zA-Z]+
		var reg = new EReg("(LOOP\\s*\\(.+?\\))\\s\\s*as\\s\\s*([a-zA-Z]+)", "");
		if (reg.match(v)) {
			var loop = reg.matched(1);
			var as = reg.matched(2);
			return CompileTimeLoop(pos, loop, as, content);
		};
		return CompileTimeLoop(pos, v, null, content);
	}

	public static function parseTLD(reader:TokenInput):AstNode {
		return switch (reader.next()) {
			// case Literal(v, _) if (StringTools.startsWith(v, "function ")):
			// 	trace(v);
			// case Literal(v, _) if (StringTools.startsWith(v, "import ")):
			// 	trace(v);
			// case Literal(v, _) if (v.charAt(0) == "#"):
			case Literal(v, pos):
				switch (v) {
					case "___internal_debugger":
						Lib.debug();
						return Comment(pos, "# debugger");
					case _ if (StringTools.startsWith(v, "function ")):
						var name = StringTools.trim(v.substring("function ".length));
						readFunction(name, reader, pos);
					case _ if (StringTools.startsWith(v, "import ")): Import(pos, v.substring("import ".length));
					case _ if (StringTools.startsWith(v, "dir ") && Type.enumIndex(reader.peek()) == TokenIds.BracketOpen):
						var content:Array<AstNode> = [];
						var data = block(reader, () -> {
							content.push(parseTLD(reader));
						}, false);
						if (data != null)
							throw unreachable(Literal(v, pos));
						Directory(pos, v.substring("dir ".length), content);
					case _ if (StringTools.startsWith(v, "#")): Comment(pos, v);
					case _ if (StringTools.startsWith(v, "LOOP")):
						parserCompilerLoop(v, pos, reader, () -> parseTLD(reader));
					case _ if (StringTools.startsWith(v, "blocks ")):
						var content:Array<AstNode> = [];
						var data = block(reader, () -> {
							content.push(innerParse(reader));
						});
						if (data != null)
							throw unreachable(Literal(v, pos));
						JsonTag(pos, v.substring("blocks ".length), JsonTagType.Blocks, content);
					case _ if (StringTools.startsWith(v, "loot ")):
						var content = json(reader);
						JsonFile(pos, v.substring("loot ".length), JsonTagType.Loot, [content]);
					default:
						throw unreachable(Literal(v, pos));
				}
			case var node:
				throw unreachable(node);
		}
	}

	private static function innerParse(reader:TokenInput):AstNode {
		var token = reader.peek();
		switch (token) {
			case Literal(v, pos):
				reader.next();
				switch (v) {
					case "___internal_debugger":
						Lib.debug();
						return Comment(pos, "# debugger");
					case "<%%":
						var content:Array<Token> = [];
						reader.next();
						while (true) {
							switch (reader.peek()) {
								case Literal(v, pos) if (v == "%%>"):
									reader.next();
									break;
								default:
							}
							content.push(reader.next());
						}

						return MultiLineScript(pos, content);

					case _ if (StringTools.startsWith(v, "execute ")):
						if (Type.enumIndex(reader.peek()) == TokenIds.BracketOpen) {
							var content:Array<AstNode> = [];
							var data = block(reader, () -> {
								content.push(innerParse(reader));
							});
							return AstNode.ExecuteBlock(pos, v, data, content);
						} else {
							return Raw(pos, v);
						}
					case _ if (StringTools.startsWith(v, "LOOP")):
						return parserCompilerLoop(v, pos, reader, () -> innerParse(reader));
					case _ if (StringTools.startsWith(v, "#")):
						return Comment(pos, v);
					default:
						return AstNode.Raw(pos, v);
				}
			case BracketOpen(pos, _):
				var content:Array<AstNode> = [];
				var data = block(reader, () -> {
					content.push(innerParse(reader));
				});
				return Block(pos, content, data);
			default:
				throw unreachable(token);
		}
	}
}

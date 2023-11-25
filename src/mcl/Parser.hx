package mcl;

import js.Lib;
import mcl.Tokenizer.PosInfo;
import mcl.AstNode.JsonTagType;
import haxe.extern.Rest;
import mcl.Tokenizer.TokenIds;
import mcl.Tokenizer.Token;

private class ArrayInput<T> {
	var array:Array<T>;
	var index:Int;

	public function new(array:Array<T>) {
		this.array = array;
		this.index = 0;
	}

	public function next():T {
		return array[index++];
	}

	@:keep
	public function skip():Void {
		index++;
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

@:expose
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

	private static function block(reader:TokenInput, sub:Void->Void, allowData:Bool = true, ?onLastToken:Token->Void):Null<String> {
		var data = expectThenData(reader, allowData);
		while (true) {
			var token = reader.peek();
			switch (token) {
				case BracketClose(_):
					if (onLastToken != null)
						onLastToken(token);
					break;
				default:
					sub();
			}
		}
		expect(reader, function(token) return Type.enumIndex(token) == TokenIds.BracketClose);
		return data == '' ? null : data;
	}

	private static function readFunction(name:String, reader:TokenInput, pos:PosInfo):AstNode {
		// expect(reader, function(token) return Type.enumIndex(token) == TokenIds.BracketOpen);
		var commands:Array<AstNode> = [];
		var appendTo:Null<String> = null;
		if (StringTools.endsWith(name, " load")) {
			appendTo = "load";
			name = StringTools.trim(name.substring(0, name.length - " load".length));
		} else if (StringTools.endsWith(name, " tick")) {
			appendTo = "tick";
			name = StringTools.trim(name.substring(0, name.length - " tick".length));
		}
		block(reader, () -> {
			commands.push(innerParse(reader));
		}, false);
		return FunctionDef(pos, name, commands, appendTo);
	}

	private static function innerParseTemplate(reader:TokenInput):AstNode {
		return switch (reader.peek()) {
			case Literal("load", pos):
				reader.skip();
				var content:Array<AstNode> = [];
				block(reader, () -> {
					content.push(innerParse(reader));
				}, false);
				AstNode.LoadBlock(pos, content);
			case Literal("tick", pos):
				reader.skip();
				var content:Array<AstNode> = [];
				block(reader, () -> {
					content.push(innerParse(reader));
				}, false);
				AstNode.TickBlock(pos, content);
			case Literal(v, pos) if (v == "with" || StringTools.startsWith(v, "with ")):
				reader.skip();
				var args = StringTools.trim(v.substring("with ".length));
				var content:Array<AstNode> = [];
				block(reader, () -> {
					content.push(innerParse(reader));
				}, false);
				AstNode.TemplateOverload(pos, args, content);
			default:
				throw unreachable(reader.next());
		}
	}

	private static function readTemplate(name:String, reader:TokenInput, pos:PosInfo) {
		var entries:Array<AstNode> = [];
		block(reader, () -> {
			entries.push(innerParseTemplate(reader));
		}, false);
		return AstNode.TemplateDef(pos, name, entries);
	}

	private static function pos(token:Token):PosInfo {
		return switch (token) {
			case Literal(_, pos) | BracketOpen(pos, _) | BracketClose(pos): pos;
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
		return Raw(pos, result, []);
	}

	public static function parseMcbFile(tokens:Array<Token>):Array<AstNode> {
		var reader = new TokenInput(tokens);
		var nodes:Array<AstNode> = [];
		while (reader.hasNext()) {
			nodes.push(parseTLD(reader));
		}
		return nodes;
	}

	public static function parseMcbtFile(tokens:Array<Token>):Array<AstNode> {
		var reader = new TokenInput(tokens);
		var nodes:Array<AstNode> = [];
		while (reader.hasNext()) {
			var token = reader.next();
			nodes.push(switch (token) {
				case Literal(v, pos):
					switch (v) {
						case _ if (StringTools.startsWith(v, "template ")):
							var name = StringTools.trim(v.substring("template ".length));
							readTemplate(name, reader, pos);
						case _ if (StringTools.startsWith(v, "#")):
							Comment(pos, v);
						case _ if (StringTools.startsWith(v, "import ")):
							Import(pos, v.substring("import ".length));
						default:
							throw unreachable(token);
					}
				default:
					throw unreachable(token);
			});
		}
		return nodes;
	}

	static var loopRegExp = new EReg("(LOOP\\s*\\(.+?\\))\\s\\s*as\\s\\s*([a-zA-Z]+)", "");

	public static function parserCompilerLoop(v:String, pos:PosInfo, reader:TokenInput, handler:Void->AstNode):AstNode {
		var content:Array<AstNode> = [];
		block(reader, () -> {
			content.push(handler());
		}); // a regex that matches LOOP(.+?)followed by an optional as [a-zA-Z]+
		if (loopRegExp.match(v)) {
			var loop = loopRegExp.matched(1);
			var as = loopRegExp.matched(2);
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
			case Literal(v, pos): switch (v) {
					case "___internal_debugger":
						Lib.debug();
						return Comment(pos, "# debugger");
					case _ if (StringTools.startsWith(v, "function ")):
						var name = StringTools.trim(v.substring("function ".length));
						readFunction(name, reader, pos);
					case _ if (StringTools.startsWith(v, "clock ")):
						var name = StringTools.trim(v.substring("clock ".length));
						var content:Array<AstNode> = [];
						block(reader, () -> {
							content.push(innerParse(reader));
						});
						ClockExpr(pos, name, content);
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
					case _ if (StringTools.startsWith(v, "LOOP")): parserCompilerLoop(v, pos, reader, () -> parseTLD(reader));
					case _ if (StringTools.startsWith(v, "IF")): parseCompileTimeIf(v, pos, reader, () -> parseTLD(reader));
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
			case var node: throw unreachable(node);
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
						reader.skip();
						while (true) {
							switch (reader.peek()) {
								case Literal("%%>", _):
									reader.skip();
									break;
								default:
							}
							content.push(reader.next());
						}
						return MultiLineScript(pos, content);
					case _ if (StringTools.startsWith(v, "IF")): return parseCompileTimeIf(v, pos, reader, () -> innerParse(reader));
					case _ if (StringTools.startsWith(v, "execute ")): if (Type.enumIndex(reader.peek()) == TokenIds.BracketOpen) {
							var content:Array<AstNode> = [];
							var data = block(reader, () -> {
								content.push(innerParse(reader));
							});
							var extraBlocks:Array<AstNode> = [];
							while (true) {
								switch (reader.peek()) {
									case Literal("else", pos):
										reader.skip();
										var elseContent:Array<AstNode> = [];
										var elseData = block(reader, () -> {
											elseContent.push(innerParse(reader));
										});
										extraBlocks.push(AstNode.Block(pos, null, elseContent, elseData));
									case Literal(v, pos) if (StringTools.startsWith(v, "else ")):
										reader.skip();
										var executeCommand = StringTools.trim(v.substring("else ".length));
										var elseContent:Array<AstNode> = [];
										var elseData = block(reader, () -> {
											elseContent.push(innerParse(reader));
										});
										pos.col += 5;
										extraBlocks.push(AstNode.ExecuteBlock(pos, executeCommand, elseData, elseContent));
									default: break;
								}
							}
							return AstNode.ExecuteBlock(pos, v, data, content, extraBlocks.length > 0 ? extraBlocks : null);
						} else {
							return readRaw(pos, v, reader);
						}
					case _ if (StringTools.startsWith(v, "LOOP")): return parserCompilerLoop(v, pos, reader, () -> innerParse(reader));
					case _ if (StringTools.startsWith(v, "#")): return Comment(pos, v);
					case _ if (v == "block" || StringTools.startsWith(v, "block ")):
						var name = StringTools.trim(v.substring("block ".length));
						var content:Array<AstNode> = [];
						var data = block(reader, () -> {
							content.push(innerParse(reader));
						});
						return Block(pos, name, content, data);
					case _ if (v == "tick"):
						var content:Array<AstNode> = [];
						block(reader, () -> {
							content.push(innerParse(reader));
						}, false);
						return TickBlock(pos, content);
					case _ if (v == "load"):
						var content:Array<AstNode> = [];
						block(reader, () -> {
							content.push(innerParse(reader));
						}, false);
						return LoadBlock(pos, content);
					default:
						return readRaw(pos, v, reader);
				}
			case BracketOpen(pos, _):
				var content:Array<AstNode> = [];
				var data = block(reader, () -> {
					content.push(innerParse(reader));
				});
				return Block(pos, null, content, data);
			default:
				throw unreachable(token);
		}
	}

	static function readRaw(pos:PosInfo, v:String, reader:TokenInput) {
		var content:Array<AstNode> = [];
		var line = pos.line;
		while (true) {
			switch (reader.peek()) {
				case Literal(v, pos) if (pos.line == line):
					reader.skip();
					content.push(Raw(pos, v, []));
				case BracketOpen(pos, data) if (pos.line == line):
					var blockContent:Array<AstNode> = [];
					var blockData = block(reader, () -> {
						blockContent.push(innerParse(reader));
					});
					content.push(Block(pos, null, blockContent, blockData));
				case BracketClose(pos) if (pos.line == line):
					throw unreachable(Literal(v, pos));
				default:
					break;
			}
		}
		return AstNode.Raw(pos, v, content);
	}

	static function parseCompileTimeIf(v:String, pos:PosInfo, reader:TokenInput, arg:() -> AstNode) {
		var exp = StringTools.trim(v.substring("IF".length));
		var content:Array<AstNode> = [];
		var data = block(reader, () -> {
			content.push(arg());
		}, false);
		var elseDatas:Array<{condition:String, node:Array<AstNode>}> = [];

		while (true) {
			switch (reader.peek()) {
				case Literal(v, pos) if (v == "ELSE" || StringTools.startsWith(v, "ELSE ")):
					reader.skip();
					var condition = v == "ELSE" ? null : StringTools.trim(v.substring("ELSE ".length));
					condition = condition != null ? StringTools.startsWith(condition,
						"IF") ? StringTools.trim(condition.substring("IF".length)) : condition : null;
					var elseContent:Array<AstNode> = [];
					block(reader, () -> {
						elseContent.push(arg());
					}, false);
					elseDatas.push({condition: condition, node: elseContent});
				default:
					break;
			}
		}
		return AstNode.CompileTimeIf(pos, exp, content, elseDatas);
	}
}

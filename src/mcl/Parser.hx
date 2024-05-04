package mcl;

import mcl.error.ParserError;
import strutils.StringUtils;
import js.Lib;
import mcl.Tokenizer.PosInfo;
import mcl.AstNode.JsonTagType;
import haxe.extern.Rest;
import mcl.Tokenizer.TokenIds;
import mcl.Tokenizer.Token;

class ArrayInput<T> {
	var array:Array<T>;
	var _index:Int;
	var index(get, set):Int;

	function get_index() {
		return _index;
	}

	function set_index(i:Int):Int {
		return _index = i;
	}

	public function new(array:Array<T>) {
		this.array = array;
		this.index = 0;
	}

	public function next():T {
		if (_index >= array.length)
			throw new ParserError('Tried to read past the end of the token list');

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

	public function insert(token:T):Void {
		array.insert(index, token);
	}

	public function back():Void {
		index--;
	}

	public function update(token:T):Void {
		array[index] = token;
	}
}

typedef TokenInput = ArrayInput<Token>;

enum abstract Errors(String) from String to String {
	var UnexpectedTokenLiteral = "Unexpected token '{}' at {}:{}:{}";
	var UnexpectedTokenBracketOpen = "Unexpected '{' with data '{}' at {}:{}:{}";
	var UnexpectedTokenBracketClose = "Unexpected '}' at {}:{}:{}";

	var ErrorWhilstEvaluatingExpression = "Encountered an error whilst evaluating expression '{}' at {}:{}:{}";
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
				throw new ParserError(format(error, v, pos.file, pos.line, pos.col));
			case BracketOpen(pos, data):
				throw new ParserError(format(error, data, pos.file, pos.line, pos.col));
			case BracketClose(pos):
				throw new ParserError(format(error, pos.file, pos.line, pos.col));
		}
	}

	private static function unreachable(token:Token) {
		return new ParserError(switch (token) {
			case Literal(v, p): format(Errors.UnexpectedTokenLiteral, v, p.file, p.line, p.col);
			case BracketOpen(p, d): format(Errors.UnexpectedTokenBracketOpen, d, p.file, p.line, p.col);
			case BracketClose(p): format(Errors.UnexpectedTokenBracketClose, p.file, p.line, p.col);
		});
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
			if (!reader.hasNext())
				throw new ParserError("Unexpected end of file!");
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
			case Literal(v, pos) if (v == "with" || StringUtils.startsWithConstExpr(v, "with ")):
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
			if (!reader.hasNext())
				throw new ParserError("Unexpected end of file!");
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
		return Raw(pos, result, [], false);
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
						case _ if (StringUtils.startsWithConstExpr(v, "template ")):
							var name = StringTools.trim(v.substring("template ".length));
							readTemplate(name, reader, pos);
						case _ if (StringUtils.startsWithConstExpr(v, "#")):
							Comment(pos, v);
						case _ if (StringUtils.startsWithConstExpr(v, "import ")):
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

	static var loopRegExp = new EReg("(REPEAT\\s*\\(.+?\\))\\s\\s*as\\s\\s*([a-zA-Z]+)", "");
	static var executeRegExp = new EReg("\\b(run\\s+?)\\b", "");

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
					case _ if (StringUtils.startsWithConstExpr(v, "function ")):
						var name = StringTools.trim(v.substring("function ".length));
						readFunction(name, reader, pos);
					case _ if (StringUtils.startsWithConstExpr(v, "clock ")):
						var time = StringTools.trim(v.substring("clock ".length));
						if (time.indexOf(" ") == -1)
							throw new ParserError(format('"Expected a name and a time for the clock command" at {}:{}:{}', pos.file, pos.line, pos.col));
						var name = StringTools.trim(time.substring(0, time.indexOf(" ") + 1));
						time = StringTools.trim(time.substring(time.indexOf(" ")));

						var content:Array<AstNode> = [];
						block(reader, () -> {
							content.push(innerParse(reader));
						});
						ClockExpr(pos, name, time, content);
					case _ if (StringUtils.startsWithConstExpr(v, "import ")): Import(pos, v.substring("import ".length));
					case _ if (StringUtils.startsWithConstExpr(v, "dir ") && Type.enumIndex(reader.peek()) == TokenIds.BracketOpen):
						var content:Array<AstNode> = [];
						var data = block(reader, () -> {
							content.push(parseTLD(reader));
						}, false);
						if (data != null)
							throw unreachable(Literal(v, pos));
						Directory(pos, v.substring("dir ".length), content);
					case _ if (StringUtils.startsWithConstExpr(v, "<%%")):
						var content:Array<Token> = [];
						while (true) {
							if (!reader.hasNext())
								throw new ParserError("Unexpected end of file!");
							switch (reader.peek()) {
								case Literal("%%>", _):
									reader.skip();
									break;
								default:
							}
							content.push(reader.next());
						}
						MultiLineScript(pos, content);
					case _ if (StringUtils.startsWithConstExpr(v, "#")): Comment(pos, v);
					case _ if (StringUtils.startsWithConstExpr(v, "REPEAT")): parserCompilerLoop(v, pos, reader, () -> parseTLD(reader));
					case _ if (StringUtils.startsWithConstExpr(v, "IF")): parseCompileTimeIf(v, pos, reader, () -> parseTLD(reader));
					case _ if (StringUtils.startsWithConstExpr(v, "tag ")):
						var sections = StringTools.trim(v.substring("tag ".length)).split(" ");
						var type = sections.shift();
						var name = sections.shift();
						var replace = sections.shift() == "replace";
						var content:Array<AstNode> = [];
						block(reader, () -> {
							content.push(innerParse(reader));
						});
						JsonFile(pos, name, Tag(type, replace, content));
					case _
						if (StringUtils.startsWithConstExpr(v, "advancement ")
							|| StringUtils.startsWithConstExpr(v, "item_modifier ")
							|| StringUtils.startsWithConstExpr(v, "loot_table ")
							|| StringUtils.startsWithConstExpr(v, "predicate ")
							|| StringUtils.startsWithConstExpr(v, "recipe ")
							|| StringUtils.startsWithConstExpr(v, "chat_type ")
							|| StringUtils.startsWithConstExpr(v, "damage_type ")
							|| StringUtils.startsWithConstExpr(v, "dimension ")
							|| StringUtils.startsWithConstExpr(v, "dimension_type ")): readPlainJsonFile(v, pos, reader);
					default:
						throw unreachable(Literal(v, pos));
				}
			case var node: throw unreachable(node);
		}
	}

	public static function readPlainJsonFile(v:String, pos:PosInfo, reader:TokenInput):AstNode {
		var bits = v.split(" ").filter(function(x) return x != "");
		var type = bits.shift();
		var name = bits.shift();
		var content:Array<AstNode> = [];
		block(reader, () -> {
			content.push(json(reader));
		});
		return JsonFile(pos, name, switch (type) {
			case "advancement": JsonTagType.Advancement(content);
			case "item_modifier": JsonTagType.ItemModifier(content);
			case "loot_table": JsonTagType.LootTable(content);
			case "predicate": JsonTagType.Predicate(content);
			case "recipe": JsonTagType.Recipe(content);
			case "chat_type": JsonTagType.ChatType(content);
			case "damage_type": JsonTagType.DamageType(content);
			case "dimension": JsonTagType.Dimension(content);
			case "dimension_type": JsonTagType.DimensionType(content);
			default:
				throw unreachable(Literal(v, pos));
		});
	}

	public static function innerParse(reader:TokenInput):AstNode {
		var token = reader.peek();
		switch (token) {
			case Literal(v, pos):
				reader.next();
				final isMacroArg = v.charAt(0) == '$';
				if (isMacroArg)
					v = v.substring(1);
				switch (v) {
					case "<%%":
						var content:Array<Token> = [];
						while (true) {
							if (!reader.hasNext())
								throw new ParserError("Unexpected end of file!");
							switch (reader.peek()) {
								case Literal("%%>", _):
									reader.skip();
									break;
								default:
							}
							content.push(reader.next());
						}
						return MultiLineScript(pos, content);
					case _ if (StringUtils.startsWithConstExpr(v, "IF")): return parseCompileTimeIf(v, pos, reader, () -> innerParse(reader));
					case _ if (StringUtils.startsWithConstExpr(v, "function ")):
						var target = v.substring("function ".length);
						var end = target.indexOf(" ");
						var name = target.substring(0, end == -1 ? target.length : end);
						var data = target.substring(name.length + 1);
						return FunctionCall(pos, name, data, isMacroArg);
					case _ if (StringUtils.startsWithConstExpr(v, "schedule ")):
						var name = StringTools.trim(v.substring("schedule ".length));
						if (StringUtils.startsWithConstExpr(name, "function ")) {
							var target = name.substring("function ".length);
							var end = target.indexOf(" ");
							var funcName = target.substring(0, end == -1 ? target.length : end);
							var delay = end == -1 ? null : target.substring(funcName.length + 1);
							var mode = "replace";
							if (StringTools.endsWith(delay, " append")) {
								mode = "append";
								delay = delay.substring(0, delay.length - " append".length);
							}
							if (StringTools.endsWith(delay, " replace")) {
								mode = "replace";
								delay = delay.substring(0, delay.length - " replace".length);
							}
							if (delay == null)
								throw new ParserError(format('"Expected delay after function name in schedule command" at {}:{}:{}', pos.file, pos.line,
									pos.col));
							return ScheduleCall(pos, delay, funcName, mode, isMacroArg);
						}
						if (StringUtils.startsWithConstExpr(name, "clear ")) {
							return ScheduleClear(pos, name.substring("clear ".length), isMacroArg);
						}
						var delayIdx = name.indexOf(" ");
						var delay = delayIdx == -1 ? name : name.substring(0, delayIdx);
						var mode = "append";
						if (StringTools.endsWith(delay, " append")) {
							mode = "append";
							delay = delay.substring(0, delay.length - " append".length);
						}
						if (StringTools.endsWith(delay, " replace")) {
							mode = "replace";
							delay = delay.substring(0, delay.length - " replace".length);
						}
						var content:Array<AstNode> = [];
						if (Type.enumIndex(reader.peek()) != 1 /* BracketOpen */) {
							throw new ParserError("Expected { after delay in schedule block command");
						}
						block(reader, () -> {
							content.push(innerParse(reader));
						});
						return ScheduleBlock(pos, delay, mode, content, isMacroArg);
					case _ if (StringUtils.startsWithConstExpr(v, "execute ")):
						if (reader.hasNext() && Type.enumIndex(reader.peek()) == TokenIds.BracketOpen) {
							var content:Array<AstNode> = [];
							if (!StringTools.endsWith(v, "run") && executeRegExp.match(v)) {
								var p = executeRegExp.matchedPos();
								var subPos:PosInfo = {file: pos.file, line: pos.line, col: pos.col + p.pos + p.len};
								var continuationToken = Token.Literal(StringTools.ltrim(v.substring(p.pos + p.len)), subPos);
								reader.insert(continuationToken);
								return Execute(pos, StringTools.rtrim(v.substring(0, p.pos + 3)), innerParse(reader), isMacroArg);
							}
							var data = block(reader, () -> {
								content.push(innerParse(reader));
							});
							var extraBlocks:Array<AstNode> = [];
							while (true) {
								if (!reader.hasNext())
									throw new ParserError("Unexpected end of file!");
								switch (reader.peek()) {
									case Literal("else $run", pos):
										reader.skip();
										var elseContent:Array<AstNode> = [];
										var elseData = block(reader, () -> {
											elseContent.push(innerParse(reader));
										});
										extraBlocks.push(AstNode.Block(pos, null, elseContent, elseData, true, false));
									case Literal("else run", pos):
										reader.skip();
										var elseContent:Array<AstNode> = [];
										var elseData = block(reader, () -> {
											elseContent.push(innerParse(reader));
										});
										extraBlocks.push(AstNode.Block(pos, null, elseContent, elseData, false, false));
									case Literal(v, pos) if (StringUtils.startsWithConstExpr(v, "else $")
										&& StringTools.endsWith(v, "run")):
										reader.skip();
										var executeCommand = StringTools.trim(v.substring("else $".length));
										var elseContent:Array<AstNode> = [];
										var elseData = block(reader, () -> {
											elseContent.push(innerParse(reader));
										});
										pos.col += 5;
										extraBlocks.push(AstNode.ExecuteBlock(pos, executeCommand, elseData, elseContent, true));
									case Literal(v, pos) if (StringUtils.startsWithConstExpr(v, "else ")
										&& StringTools.endsWith(v, "run")):
										reader.skip();
										var executeCommand = StringTools.trim(v.substring("else ".length));
										var elseContent:Array<AstNode> = [];
										var elseData = block(reader, () -> {
											elseContent.push(innerParse(reader));
										});
										pos.col += 5;
										extraBlocks.push(AstNode.ExecuteBlock(pos, executeCommand, elseData, elseContent, false));
									default: break;
								}
							}
							return AstNode.ExecuteBlock(pos, v, data, content, extraBlocks.length > 0 ? extraBlocks : null, isMacroArg);
						} else {
							if (!executeRegExp.match(v))
								return readRaw(pos, v, reader, isMacroArg);
							var p = executeRegExp.matchedPos();
							var subPos:PosInfo = {file: pos.file, line: pos.line, col: pos.col + p.pos + p.len};
							var continuationToken = Token.Literal(StringTools.ltrim(v.substring(p.pos + p.len)), subPos);
							reader.insert(continuationToken);
							return Execute(pos, StringTools.rtrim(v.substring(0, p.pos + 3)), innerParse(reader), isMacroArg);
						}
					case _ if (StringUtils.startsWithConstExpr(v, "REPEAT")): return parserCompilerLoop(v, pos, reader, () -> innerParse(reader));
					case _ if (StringUtils.startsWithConstExpr(v, "#")): return Comment(pos, v);
					case _ if (v == "block" || StringUtils.startsWithConstExpr(v, "block ")):
						var name = StringTools.trim(v.substring("block ".length));
						var content:Array<AstNode> = [];
						var data = block(reader, () -> {
							content.push(innerParse(reader));
						});
						return Block(pos, name, content, data, isMacroArg, false);
					case _ if (StringUtils.startsWithConstExpr(v, "return run")):
						var subCommand = StringTools.trim(v.substring("return run ".length));
						var pos:PosInfo = {
							file: pos.file,
							line: pos.line,
							col: pos.col + "return run ".length
						};
						switch (reader.peek()) {
							case BracketOpen(pos, data):
								var content:Array<AstNode> = [];
								var data = block(reader, () -> {
									content.push(innerParse(reader));
								});
								return ReturnRun(pos, Block(pos, null, content, data, false, false), isMacroArg);
							default:
								reader.back();
								reader.update(Literal(subCommand, pos));
								return ReturnRun(pos, innerParse(reader), isMacroArg);
						}
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
					case _ if (StringUtils.startsWithConstExpr(v, "eq ")):
						return EqCommand(pos, v.substring("eq ".length));
					default:
						return readRaw(pos, v, reader, isMacroArg);
				}
			case BracketOpen(pos, _):
				var content:Array<AstNode> = [];
				var data = block(reader, () -> {
					content.push(innerParse(reader));
				});
				return Block(pos, null, content, data, false, false);
			default:
				throw unreachable(token);
		}
	}

	static function readRaw(pos:PosInfo, v:String, reader:TokenInput, isMacro:Bool) {
		if (!reader.hasNext()) // this function CAN be called with the last token in the reader if parsing a single command via emit.mcb
			return AstNode.Raw(pos, v, [], isMacro);
		var content:Array<AstNode> = [];
		var line = pos.line;
		while (true) {
			if (!reader.hasNext())
				throw new ParserError("Unexpected end of file!");
			switch (reader.peek()) {
				case Literal(v, pos) if (pos.line == line):
					reader.skip();
					content.push(Raw(pos, v, [], false));
				case BracketOpen(pos, data) if (pos.line == line):
					var blockContent:Array<AstNode> = [];
					var blockData = block(reader, () -> {
						blockContent.push(innerParse(reader));
					});
					content.push(Block(pos, null, blockContent, blockData, false, false));
				case BracketClose(pos) if (pos.line == line):
					throw unreachable(Literal(v, pos));
				default:
					break;
			}
		}
		return AstNode.Raw(pos, v, content, isMacro);
	}

	static function parseCompileTimeIf(v:String, pos:PosInfo, reader:TokenInput, arg:() -> AstNode) {
		var exp = StringTools.trim(v.substring("IF".length));
		var content:Array<AstNode> = [];
		block(reader, () -> {
			content.push(arg());
		}, false);
		var elseDatas:Array<{condition:String, node:Array<AstNode>}> = [];

		while (true) {
			if (!reader.hasNext())
				throw new ParserError("Unexpected end of file!");
			switch (reader.peek()) {
				case Literal(v, pos) if (v == "ELSE" || StringUtils.startsWithConstExpr(v, "ELSE ")):
					reader.skip();
					var condition = v == "ELSE" ? null : StringTools.trim(v.substring("ELSE ".length));
					condition = condition != null ? StringUtils.startsWithConstExpr(condition,
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

package mcl;

@:expose
class AstStringifier {
	var segments:Array<String> = [];
	var indent:Int = 0;
	var tabs:Array<String> = [""];

	public function new() {}

	function tab() {
		var tab = tabs.length > indent ? tabs[indent] : {
			var s = tabs[tabs.length - 1];
			for (i in (tabs.length - 1)...(indent)) {
				tabs[i] = s;
				s += "\t";
			}
			s;
		};
		segments.push(tab);
	}

	function inc() {
		indent++;
	}

	function dec() {
		indent--;
	}

	inline function literal(s:String) {
		segments.push(s);
	}

	function write(node:AstNode, indent:Bool = true, hideBlock:Bool = false) {
		if (!indent && StringTools.endsWith(segments[segments.length - 1], "\\")) {
			literal("\n");
			indent = true;
		}
		switch (node) {
			default:
				throw "unknown node type: " + Std.string(node);
			case Raw(pos, value, continuations, isMacro):
				if (indent)
					tab();
				if (isMacro)
					literal("$");
				literal(value);
				if (continuations.length > 0) {
					throw "continuations not supported";
				}
				literal("\n");
			case FunctionDef(pos, name, body, appendTo):
				if (indent)
					tab();
				literal("function ");
				literal(name);
				if (appendTo != null) {
					literal(" ");
					literal(appendTo);
				}
				literal("{\n");
				inc();
				for (child in body) {
					write(child);
				}
				dec();
				tab();
				literal("}\n");
			case TemplateDef(pos, name, body):
				throw "template def not supported";
			case Directory(pos, name, body):
				if (indent)
					tab();
				literal("dir ");
				literal(name);
				literal("{\n");
				inc();
				for (child in body) {
					write(child);
				}
				dec();
				tab();
				literal("}\n");
			case Import(pos, name):
				if (indent)
					tab();
				literal("import ");
				literal(name);
				literal("\n");
			case CompileTimeLoop(pos, expression, as, body):
				if (indent)
					tab();
				literal('REPEAT($expression) as ${as} {');
				inc();
				for (child in body) {
					write(child);
				}
				dec();
				literal("}\n");
			case CompileTimeIf(pos, expression, body, elseExpressions):
				if (indent)
					tab();
				literal('IF($expression) {');
				inc();
				for (child in body) {
					write(child);
				}
				dec();
				tab();
				literal("}");
				for (elseExpression in elseExpressions) {
					literal(' ELSE ${elseExpression.condition == null ? 'IF(${elseExpression.condition})' : ''} {');
					inc();
					for (child in elseExpression.node) {
						write(child);
					}
					dec();
					tab();
					literal("}");
				}
				literal("\n");
			case MultiLineScript(pos, value):
				throw "multi line script not supported";
			case Block(pos, name, body, data, isMacro, isInline):
				if (indent)
					tab();
				if (isMacro && !hideBlock)
					literal("$");
				if (!hideBlock)
					literal("block");
				if (name != null && name != "") {
					literal(" ");
					literal(name);
					literal(" ");
				}
				literal('{${data == null ? '' : ' ' + data}\n');
				inc();
				for (child in body) {
					write(child);
				}
				dec();
				tab();
				literal("}");
				if (indent)
					literal("\n");
			case TickBlock(pos, body):
				if (indent)
					tab();
				literal("tick {\n");
				inc();
				for (child in body) {
					write(child);
				}
				dec();
				tab();
				literal("}\n");
			case LoadBlock(pos, body):
				if (indent)
					tab();
				literal("load {\n");
				inc();
				for (child in body) {
					write(child);
				}
				dec();
				tab();
				literal("}\n");
			case ExecuteBlock(pos, execute, data, body, continuations, isMacro):
				if (indent)
					tab();
				if (isMacro)
					literal("$");
				// literal("execute");
				// if (execute != null) {
				// 	literal(" ");
				// literal('<b>');
				literal(execute);
				// }
				literal(' {${data == null ? '' : ' ' + data}\n');
				inc();
				for (child in body) {
					write(child);
				}
				dec();
				tab();
				literal("}");
				var i = 0;
				var lastI = continuations.length - 1;
				for (continuation in continuations) {
					switch (continuation) {
						case Block(pos, '' | null, body, data, isMacro, isInline):
							literal(' else ${isMacro ? "$" : ""}run ');
							write(continuation, false, true);
						default:
							literal(" else ");
							write(continuation, false, true);
					}
					i++;
				}
				// literal("</b>");
				if (indent)
					literal("\n");
			case ScheduleBlock(pos, delay, type, body, isMacro):
				if (indent)
					tab();
				if (isMacro)
					literal("$");
				literal("schedule ");
				literal(delay);
				literal(" ");
				literal(type);
				literal(" {\n");
				inc();
				for (child in body) {
					write(child);
				}
				dec();
				tab();
				literal("}\n");
			case Comment(pos, value):
				if (indent)
					tab();
				literal("# ");
				literal(value);
				literal("\n");
			case JsonFile(pos, name, info):
				tab();
				switch (info) {
					case Tag(subType, replace, entries):
						literal("tag ");
						literal(subType);
						literal(" ");
						literal(name);
						if (replace)
							literal(" replace");
						literal(" {\n");
						inc();
						for (entry in entries) {
							// tab();
							write(entry);
						}
						dec();
						tab();
						literal("}\n");
					case WorldGen(subType, name, entries):
						literal("worldgen ");
						literal(name);
						literal(" {\n");
						inc();
						for (entry in entries) {
							// tab();
							write(entry);
						}
						dec();
						tab();
						literal("}\n");
					case node:
						var entries:Array<AstNode> = Reflect.getProperty(node, 'entries');
						literal(Std.string(node));
				}
			case ClockExpr(pos, name, time, body):
				if (indent)
					tab();
				literal("clock ");
				literal(name);
				literal(" ");
				literal(time);
				literal(" {\n");
				inc();
				for (child in body) {
					write(child);
				}
				dec();
				tab();
				literal("}\n");
			case Execute(pos, command, value, isMacro):
				if (indent)
					tab();
				if (isMacro)
					literal("$");
				// literal("execute ");
				literal(command);
				literal(" ");
				// inc();
				write(value, false);
				// dec();
				// literal('</a>');
				literal("\n");
			case FunctionCall(pos, name, data, isMacro):
				if (indent)
					tab();
				if (isMacro)
					literal("$");
				literal("function ");
				literal(name);
				if (data != null && data != "") {
					literal(" ");
					literal(data);
				}
				literal("\n");
			case EqCommand(pos, command):
				if (indent)
					tab();
				literal('eq ' + command);
				literal("\n");
			case ScheduleCall(pos, delay, target, mode, isMacro):
				if (indent)
					tab();
				if (isMacro)
					literal("$");
				literal("schedule function ");
				literal(target);
				literal(" ");
				literal(delay);
				literal(" ");
				literal(mode);
				literal("\n");
			case ReturnRun(pos, value, isMacro):
				if (indent)
					tab();
				if (isMacro)
					literal("$");
				literal("return run ");
				inc();
				write(value, false, true);
				dec();
				literal("\n");
			case ScheduleClear(pos, target, isMacro):
				if (indent)
					tab();
				if (isMacro)
					literal("$");
				literal("schedule clear ");
				literal(target);
				literal("\n");
			case Void: // ignore
			case Group(body):
				var isInline = indent == false;
				for (child in body) {
					if (!indent && !isInline) {
						throw "Group should not have multiple children if the location is inline";
					}
					write(child, indent);
					isInline = false;
				}
		}
	}

	function toString(node:AstNode):String {
		write(node);
		return segments.join("");
	}

	public static function stringify(node:AstNode):String {
		return new AstStringifier().toString(node);
	}
}

package mcl;

@:expose
class AstStringifier {
	var writer:StringBuf = new StringBuf();
	var indent:Int = 0;

	public function new() {}

	function tab() {
		writer.add([for (i in 0...indent) "\t"].join(""));
	}

	function inc() {
		indent++;
	}

	function dec() {
		indent--;
	}

	inline function literal(s:String) {
		writer.add(s);
	}

	function write(node:AstNode) {
		switch (node) {
			default:
				throw "unknown node type: " + Std.string(node);
			case Raw(pos, value, continuations, isMacro):
				tab();
				literal(value);
				if (continuations.length > 0) {
					throw "continuations not supported";
				}
				literal("\n");
			case FunctionDef(pos, name, body, appendTo):
				tab();
				literal("function ");
				literal(name);
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
				tab();
				literal("directory ");
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
				tab();
				literal("import ");
				literal(name);
				literal("\n");
			case CompileTimeLoop(pos, expression, as, body):
				tab();
				literal('REPEAT($expression) as ${as} {');
				inc();
				for (child in body) {
					write(child);
				}
				dec();
				literal("}\n");
			case CompileTimeIf(pos, expression, body, elseExpressions):
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
				tab();
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
				literal("}\n");
			case TickBlock(pos, body):
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
				tab();
				if (isMacro)
					literal("$");
				literal("execute");
				if (execute != null) {
					literal(" ");
					literal(execute);
				}
				literal('{${data == null ? '' : ' ' + data}\n');
				inc();
				for (child in body) {
					write(child);
				}
				dec();
				tab();
				literal("}");
				for (continuation in continuations) {
					literal(" ");
					write(continuation);
				}
				literal("\n");
			case ScheduleBlock(pos, delay, type, body, isMacro):
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
				tab();
				literal("# ");
				literal(value);
				literal("\n");
			case JsonFile(pos, name, info):
				tab();
				switch (info) {
					case Tag(subType, replace, entries):
						literal("tag ");
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
				tab();
				if (isMacro)
					literal("$");
				literal("execute ");
				literal(command);
				literal(" \\");
				inc();
				write(value);
				dec();
				literal("\n");
			case FunctionCall(pos, name, data, isMacro):
				tab();
				if (isMacro)
					literal("$");
				literal(name);
				if (data != null && data != "") {
					literal(" ");
					literal(data);
				}
				literal("\n");
			case EqCommand(pos, command):
				tab();
				literal('eq ' + command);
				literal("\n");
			case ScheduleCall(pos, delay, target, mode, isMacro):
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
				tab();
				if (isMacro)
					literal("$");
				literal("return run \\");
				inc();
				write(value);
				dec();
				literal("\n");
			case ScheduleClear(pos, target, isMacro):
				tab();
				if (isMacro)
					literal("$");
				literal("schedule clear ");
				literal(target);
				literal("\n");
			case Void: // ignore
			case Group(body):
				for (child in body) {
					write(child);
				}
		}
	}

	function toString(node:AstNode):String {
		write(node);
		return writer.toString();
	}

	public static function stringify(node:AstNode):String {
		return new AstStringifier().toString(node);
	}
}

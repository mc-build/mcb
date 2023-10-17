package mcl;

import mcl.AstNode.CompileTimeIfElseExpressions;
import mcl.AstNode.AstNodeUtils;
import mcl.AstNode.AstNodeIds;
import mcl.Parser.Errors;
import js.Syntax;
import mcl.AstNode.JsonTagType;
import mcl.Tokenizer.PosInfo;
import js.Lib;
import haxe.io.Path;

private class ErrorUtil {
	public static function format(message:String, pos:PosInfo):String {
		return '${pos.file}:${pos.line}:${pos.col}: ${message}';
	}

	public static function formatWithStack(message:String, stack:Array<PosInfo>):String {
		var res = message;
		for (pos in stack) {
			res += '\n\tat ${pos.file}:${pos.line}:${pos.col}';
		}
		return res;
	}

	public static function formatContext(message:String, pos:PosInfo, context:CompilerContext):String {
		return formatWithStack(message, context.stack.concat([pos]));
	}

	public static function unexpectedToken(node:AstNode, context:CompilerContext):String {
		return formatContext('Unexpected: ${node}', AstNodeUtils.getPos(node), context);
	}
}

private class TemplateArgument {
	var name:String;

	function new(s:String) {
		this.name = s;
	}

	public static function parse(s:String, p:PosInfo) {
		trace(s, p);
		return new TemplateArgument(s);
	}
}

private class McTemplate {
	private var name:String;
	private var body:Array<AstNode>;
	private var overlands:Map<Array<TemplateArgument>, Array<AstNode>> = new Map();
	private var installed:Bool = false;
	private var loadBlock:Null<Array<AstNode>> = null;
	private var tickBlock:Null<Array<AstNode>> = null;
	private var file:McFile;

	public function new(name:String, body:Array<AstNode>, file:McFile) {
		this.name = name;
		this.body = body;
		this.parse(body);
	}

	private function compileArgs(args:String, pos:PosInfo) {
		var arguments:Array<TemplateArgument> = [];
		var sections = args.split(' ');
		var offset = 0;
		for (section in sections) {
			if (section == "") {
				offset++;
				continue;
			}
			arguments.push(TemplateArgument.parse(section, {
				file: pos.file,
				line: pos.line,
				col: pos.col + offset
			}));
			offset += section.length;
		}
		return arguments;
	}

	private function parse(nodes:Array<AstNode>) {
		for (node in nodes) {
			switch (node) {
				case TemplateOverload(pos, args, body):
					overlands.set(compileArgs(args, pos), body);
				case LoadBlock(pos, body):
					if (loadBlock == null)
						loadBlock = body;
					else
						throw ErrorUtil.format("Templates can only have one top-level load block", pos);
				case TickBlock(pos, body):
					if (tickBlock == null)
						tickBlock = body;
					else
						throw ErrorUtil.format("Templates can only have one top-level tick block", pos);
				case _ if (Type.enumIndex(node) == AstNodeIds.Comment):
				// ignore comments on the top level, they are allowed but have no output
				default:
					throw ErrorUtil.format("Unexpected node type: " + Std.string(node), Reflect.field(node, 'pos'));
			}
		}
	}
}

private class VariableMap {
	var parent:Null<VariableMap>;
	var variables:Map<String, Any>;
	private var _cache:Null<Map<String, Any>>;

	public function new(parent:Null<VariableMap>, variables:Null<Map<String, Any>> = null) {
		this.parent = parent;
		this.variables = variables == null ? new Map() : variables;
	}

	public function get():Map<String, Any> {
		if (_cache != null)
			return [for (k => v in _cache) k => v];
		var res:Map<String, Any> = parent == null ? new Map() : this.parent.get();
		for (k => v in variables) {
			res.set(k, v);
		}
		_cache = res;
		return res;
	}

	public inline function fork(variables:Null<Map<String, Any>> = null):VariableMap {
		if (variables == null)
			return this;
		return new VariableMap(this, variables);
	}
}

typedef CompilerContext = {
	var append:String->Void;
	var namespace:String;
	var path:Array<String>;
	var uidIndex:Int;
	var variables:VariableMap;
	var replacements:VariableMap;
	var stack:Array<PosInfo>;
	var isTemplate:Bool;
};

private class McFile {
	public var name:String;

	public var existingDirectories:Map<String, Bool> = new Map();

	private var ast:Array<AstNode> = [];
	private var templates:Map<String, McTemplate> = new Map();
	private var imports:Map<String, McFile> = new Map();
	private var ext:String;

	public function new(name:String, ast:Array<AstNode>) {
		this.name = name;
		this.ast = ast;
		this.ext = Path.extension(name);
	}

	public function getTemplates():Map<String, McTemplate> {
		if (this.ext == "mcbt") {
			return templates;
		}
		throw "Internal error: tried to get templates from non-template file:" + this.name;
	}

	public function setup() {
		var ast = this.ast;
		this.ast = [];
		for (node in ast) {
			switch (node) {
				case Import(_, importName):
					imports.set(importName, Compiler.instance.resolve(this.name, importName));
				case TemplateDef(_, name, body):
					templates.set(name, new McTemplate(name, body, this));
				case Comment(_, _):
				default:
					this.ast.push(node);
			}
		}
		for (dep in imports) {
			var importedTemplates = dep.getTemplates();
			for (k => v in importedTemplates) {
				templates.set(k, v);
			}
		}
	}

	private function getFunctionUid(namespace:String, name:String):String {
		var id = "";
		return '$namespace:$id';
	}

	private inline function forkCompilerContextWithAppend(context:CompilerContext, append:String->Void):CompilerContext {
		return createCompilerContext(context.namespace, append, context.variables, context.path, context.uidIndex, context.stack, context.replacements);
	}

	private inline function createCompilerContext(namespace:String, append:String->Void, variableMap:VariableMap, path:Array<String>, uidIndex:Int,
			stack:Array<PosInfo>, replacements:VariableMap):CompilerContext {
		return {
			append: append,
			namespace: namespace,
			path: path == null ? [] : path,
			uidIndex: uidIndex,
			variables: variableMap,
			stack: stack,
			replacements: replacements,
			isTemplate: this.ext == "mcbt"
		};
	}

	private inline function saveContent(path:String, content:String) {
		Compiler.io.write(path, content);
	}

	private function createAnonymousFunction(pos:PosInfo, body:Array<AstNode>, data:Null<String>, context:CompilerContext, name:Null<String> = null):String {
		var commands:Array<String> = [];
		var newContext = createCompilerContext(context.namespace, v -> {
			commands.push(v);
		}, context.variables.fork(),
			context.path.concat(['zzz']), context.uidIndex, context.stack, context.variables);
		for (node in body) {
			compileCommandUnit(node, newContext);
		}
		var result = commands.join("\n");
		if (name != null)
			name = injectValues(name, context, pos);
		var id = name == null ? 'zzz/${Std.string(context.uidIndex++)}' : name;
		saveContent(Path.join(['data', context.namespace, 'functions'].concat(context.path.concat([id + ".mcfunction"]))), result);
		return 'function ${context.namespace}:${context.path.join("/")}/$id' + (data == null ? '' : ' $data');
	}

	private function compileCommandUnit(node:AstNode, context:CompilerContext):Void {
		switch (node) {
			case Raw(pos, value):
				context.append(injectValues(value, context, pos));
			case Comment(_, value):
				context.append(value);
			case AstNode.Block(pos, null, body, data) | AstNode.Block(pos, "", body, data):
				context.append(createAnonymousFunction(pos, body, data, context));
			case CompileTimeIf(pos, expression, body, elseExpressions):
				compileTimeIf(expression, body, elseExpressions, pos, context, (v) -> {
					compileCommandUnit(v, context);
				});
			case ExecuteBlock(pos, execute, data, body, continuations):
				var commands:Array<String> = [];
				var append = function(command:String) {
					commands.push(command);
				};
				var newContext = createCompilerContext(context.namespace, append, context.variables, context.path, context.uidIndex, context.stack,
					context.replacements);
				for (node in body) {
					compileCommandUnit(node, newContext);
				}
				if (continuations != null) {
					context.append('scoreboard players set #ifelse int 0');
					append('scoreboard players set #ifelse int 1');
				}
				var result = commands.join("\n");
				var id = Std.string(context.uidIndex++);
				saveContent(Path.join(['data', context.namespace, 'functions'].concat(context.path.concat(['zzz', id + ".mcfunction"]))), result);
				context.append(injectValues('$execute function ${context.namespace}:${context.path.concat(['zzz', id]).join("/")}'
					+ (data == null ? '' : ' $data'), context, pos));
				if (continuations != null) {
					// newContext.append('scoreboard players set %ifelse int 1');
					var idx = 0;
					for (continuation in continuations) {
						var isDone = idx == continuations.length - 1;
						switch (continuation) {
							case ExecuteBlock(pos, execute, data, body, _):
								var embedCommands:Array<String> = [];
								var embedAppend = function(command:String) {
									embedCommands.push(command);
								};
								var embedContext = createCompilerContext(context.namespace, embedAppend, context.variables, context.path, context.uidIndex,
									context.stack, context.replacements);

								for (node in body) {
									compileCommandUnit(node, embedContext);
								}
								if (!isDone)
									embedAppend('scoreboard players set %ifelse int 1');

								var result = commands.join("\n");

								var id = Std.string(context.uidIndex++);

								saveContent(Path.join(['data', context.namespace, 'functions'].concat(context.path.concat(['zzz', id + ".mcfunction"]))),
									result);

								var executeCommandArgs = StringTools.startsWith(execute, "execute ") ? execute.substring(8) : execute;
								context.append('execute if score #ifelse int matches 0 $executeCommandArgs run function ${context.namespace}:${context.path.concat(['zzz', id]).join("/")}'
									+ (data == null ? '' : ' $data'));
							case Block(_, _, body, data):
								var embedCommands:Array<String> = [];
								if (!isDone)
									throw "Internal error: block continuation must be the last continuation";
								var appendEmbed = function(command:String) {
									embedCommands.push(command);
								};
								var embedContext = createCompilerContext(context.namespace, appendEmbed, context.variables, context.path, context.uidIndex,
									context.stack, context.replacements);
								for (node in body) {
									compileCommandUnit(node, embedContext);
								}
								var result = embedCommands.join("\n");
								var id = Std.string(context.uidIndex++);
								saveContent(Path.join(['data', context.namespace, 'functions'].concat(context.path.concat(['zzz', id + ".mcfunction"]))),
									result);
								context.append('execute if score #ifelse int matches 0 run function ${context.namespace}:${context.path.concat(['zzz', id]).join("/")}'
									+ (data == null ? '' : ' $data'));

							default: throw ErrorUtil.formatContext("Unexpected continuation type: " + Std.string(continuation),
									AstNodeUtils.getPos(continuation), newContext);
						}
						idx++;
					}
				}

			case CompileTimeLoop(pos, expression, as, body):
				processCompilerLoop(expression, as, context, body, pos, (context, v) -> {
					return compileCommandUnit(v, context);
				});
			case Block(pos, name, body, data):
				context.append(createAnonymousFunction(pos, body, data, context, name));
			default:
				Lib.debug();
				trace(Std.string(node));
		}
	}

	private function compileFunction(pos:PosInfo, name:String, body:Array<AstNode>, appendTo:Null<String>, context:CompilerContext) {
		name = injectValues(name, context, pos);
		var commands:Array<String> = [];
		var append = function(command:String) {
			commands.push(command);
		};
		var context = createCompilerContext(context.namespace, append, context.variables, context.path, context.uidIndex, context.stack, context.replacements);
		for (node in body) {
			compileCommandUnit(node, context);
		}
		var funcId = context.namespace + ":" + context.path.concat([name]).join("/");
		if (appendTo != null) {
			if (appendTo == "load") {
				Compiler.instance.tags.addLoadingCommand(funcId);
			} else if (appendTo == "tick") {
				Compiler.instance.tags.addTickingCommand(funcId);
			} else {
				throw "Internal error: unexpected appendTo value: " + appendTo;
			}
		}
		saveContent(Path.join(['data', context.namespace, 'functions'].concat(context.path.concat([name + ".mcfunction"]))), commands.join("\n"));
	}

	private function compileDirectory(pos:PosInfo, name:String, body:Array<AstNode>, context:CompilerContext) {
		name = injectValues(name, context, pos);
		var newContext = createCompilerContext(context.namespace, v -> {
			throw "Internal error: append not available for directory context";
		}, context.variables.fork(), context.path.concat([name]), 0,
			context.stack, context.replacements);
		for (node in body) {
			compileTld(node, newContext);
		}
	}

	private function compileTld(node:AstNode, context:CompilerContext) {
		switch (node) {
			case FunctionDef(pos, name, body, appendTo) if (!context.isTemplate):
				compileFunction(pos, name, body, appendTo, context);
			case Directory(pos, name, body):
				compileDirectory(pos, name, body, context);
			// void
			case JsonTag(pos, name, type, value):
				compileJsonTag(pos, name, type, value, context);
			case JsonFile(pos, name, type, value):
				compileJsonFile(pos, name, type, value, context);
			case CompileTimeLoop(pos, expression, as, body):
				processCompilerLoop(expression, as, context, body, pos, (context, v) -> {
					return compileTld(v, context);
				});
			case CompileTimeIf(pos, expression, body, elseExpressions):
				compileTimeIf(expression, body, elseExpressions, pos, context, (v) -> {
					compileTld(v, context);
				});
			case ClockExpr(pos, time, body):
				var commands:Array<String> = [];
				var newContext = createCompilerContext(context.namespace, v -> {
					commands.push(v);
				}, context.variables, context.path, context.uidIndex, context.stack,
					context.replacements);

				var id = Std.string(context.uidIndex++);
				var functionId = context.namespace + ":" + context.path.concat(["zzz", '$id']).join("/");
				commands.push('schedule $functionId $time replace');
				for (node in body) {
					compileCommandUnit(node, newContext);
				}
				var result = commands.join("\n");
				saveContent(Path.join(['data', context.namespace, 'functions'].concat(context.path.concat(['zzz', id + ".mcfunction"]))), result);
				Compiler.instance.tags.addLoadingCommand(functionId);
			case _ if (Type.enumIndex(node) == AstNodeIds.Comment):
			// ignore comments on the top level, they are allowed but have no output
			default:
				throw "Internal error: unexpected node type:" + Std.string(node);
		}
	}

	function compileJsonTag(pos:PosInfo, name:String, type:JsonTagType, value:Array<AstNode>, context:CompilerContext) {
		name = injectValues(name, context, pos);
		var filePath = switch (type) {
			case Blocks:
				['data', context.namespace, 'tags', 'blocks'];
			default: throw "Internal error: unexpected json tag type:" + Std.string(type);
		}
		var path = Path.join(context.path.concat(filePath.concat([name + ".json"])));
		saveContent(path, stringifyJsonTag(pos, name, value, context));
	}

	function compileJsonFile(pos:PosInfo, name:String, type:JsonTagType, value:Array<AstNode>, context:CompilerContext) {
		var filePath = switch (type) {
			case Loot:
				['data', context.namespace, 'loot_tables'];
			default: throw "Internal error: unexpected json tag type:" + Std.string(type);
		}
		var path = Path.join(context.path.concat(filePath.concat([name + ".json"])));
		saveContent(path, stringifyJsonTag(pos, name, value, context));
	}

	function processCompilerLoop(expression:String, as:Null<String>, context:CompilerContext, body:Array<AstNode>, pos:PosInfo,
			handler:CompilerContext->AstNode->Void) {
		var itterator = invokeExpressionInline(expression, context, pos);
		for (v in itterator) {
			if (as == null) {
				for (node in body) {
					handler(context, node);
				}
			} else {
				var newContext = createCompilerContext(context.namespace, context.append, context.variables.fork([as => v]), context.path, context.uidIndex,
					context.stack, context.variables);
				for (node in body) {
					handler(newContext, node);
				}
				context.uidIndex = newContext.uidIndex;
			}
		}
	}

	function stringifyJsonTag(pos:PosInfo, name:String, value:Array<AstNode>, context:CompilerContext) {
		name = injectValues(name, context, pos);
		var res = "";
		var values:Array<String> = [];
		var newContext = createCompilerContext(context.namespace, v -> {
			values.push(v);
		}, context.variables, context.path, context.uidIndex, context.stack,
			context.variables);
		for (v in value) {
			switch (v) {
				case Raw(pos, value):
					values.push(injectValues(value, context, pos));
				case CompileTimeLoop(pos, expression, as, body):
					processCompilerLoop(expression, as, context, body, pos, (context, v) -> {
						return compileCommandUnit(v, context);
					});
				case CompileTimeIf(pos, expression, body, elseExpression):
					compileTimeIf(expression, body, elseExpression, pos, newContext, (v) -> {
						compileCommandUnit(v, context);
					});
				default:
					throw "Internal error: unexpected node type:" + Std.string(v);
			}
		}

		return values.join('');
	}

	function injectValues(target:String, context:CompilerContext, pos:PosInfo):String {
		if (target.indexOf("<%") == -1)
			return target;
		var variables = context.variables.get();
		var argList:Array<String> = [];
		var valueList:Array<Any> = [];
		for (k => v in variables) {
			argList.push(k);
			valueList.push(v);
		}
		var segments:Array<String> = [];
		var values:Array<String> = [];
		for (segment in target.split("<%")) {
			// "afdsfs" or "afdsfs%>"
			var parts = segment.split("%>");
			if (parts.length == 1) {
				values.push(parts[0]);
				segments.push('${"$$context"}[' + Std.string(values.length - 1) + ']');
			} else {
				segments.push(parts[0]);
				values.push(parts[1]);
				segments.push('${"$$context"}[' + Std.string(values.length - 1) + ']');
			}
		}
		var code = 'return ([${segments.join(",")}].join(\'\'));';
		try {
			return Syntax.code("new Function(...{1},\"$$context\",{0}).apply(null, {2}.concat([{3}]));", code, argList, valueList, values);
		} catch (e) {
			throw Parser.format(Errors.ErrorWhilstEvaluatingExpression, e.message, pos.file, pos.line, pos.col);
		}
	}

	function invokeExpressionInline(expression:String, context:CompilerContext, pos:PosInfo):Any {
		var variables = context.variables.get();
		var argList:Array<String> = [];
		var valueList:Array<Any> = [];
		for (k => v in variables) {
			argList.push(k);
			valueList.push(v);
		}
		var code = 'return ($expression);';
		try {
			return Syntax.code('new Function(...{1},{0}).apply(null, {2});', code, argList, valueList);
		} catch (e) {
			throw Parser.format(Errors.ErrorWhilstEvaluatingExpression, e.message, pos.file, pos.line, pos.col);
		}
	}

	function compileTimeIf(expression:String, body:Array<AstNode>, elseExpression:CompileTimeIfElseExpressions, pos:PosInfo, newContext:CompilerContext,
			processNode:AstNode->Void, isContinuation:Bool = false) {
		var bool = invokeExpressionInline(expression, newContext, pos);
		if (bool) {
			for (node in body) {
				processNode(node);
			}
		} else {
			for (elseNode in elseExpression) {
				var invoke = elseNode.condition == null ? true : invokeExpressionInline(elseNode.condition, newContext, pos);
				if (invoke) {
					for (node in elseNode.node) {
						processNode(node);
					}
					return;
				}
			}
		}
	}

	public function compile() {
		var context = createCompilerContext(new Path(this.name).file, v -> {
			throw "Internal error: append not available for top-level context";
		}, new VariableMap(null, Globals.map), [], 0, [], new VariableMap(null, []));
		if (context.isTemplate) {
			if (ast.length > 0) {
				throw ErrorUtil.formatContext("Unexpected top-level content in template file", AstNodeUtils.getPos(ast[0]), context);
			}
			return;
		}
		for (node in ast) {
			switch (node) {
				case Import(_, _) | TemplateDef(_, _, _):
					throw "Internal error: import or template definition found after setup";
				default:
					compileTld(node, context);
			}
		}
	}
}

class Compiler {
	public static var io:Io = new Io.SyncIo();
	public static var instance:Compiler = new Compiler();

	private var files:Map<String, McFile> = new Map();
	private var alreadySetupFiles = new Map<String, Bool>();

	public var tags:TagManager = new TagManager();

	public function addFile(name:String, ast:Array<AstNode>) {
		var file = new McFile(name, ast);
		files.set(name, file);
	}

	public function resolve(baseFile:String, resolutionPath:String):McFile {
		var base = Path.directory(baseFile);
		var resolved = Path.join([base, resolutionPath]);
		if (files.exists(resolved)) {
			if (!alreadySetupFiles.exists(resolved)) {
				alreadySetupFiles.set(resolved, true);
				files.get(resolved).setup();
			}
			return files.get(resolved);
		}
		throw "Failed to resolve import: " + resolved;
	}

	public function compile() {
		for (file in files) {
			if (alreadySetupFiles.exists(file.name))
				continue;
			file.setup();
		}

		for (file in files) {
			file.compile();
		}
		tags.writeTagFiles();
	}

	public function new() {}
}

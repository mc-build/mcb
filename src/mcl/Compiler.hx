package mcl;

import mcl.error.McbError;
import mcl.error.CompilerError;
import mcl.Config.UserConfig;
import haxe.Json;
import strutils.StringUtils;
import ext.Module;
import mcl.Parser.TokenInput;
import mcl.Tokenizer.Token;
import haxe.ds.IntMap;
import mcl.AstNode.CompileTimeIfElseExpressions;
import mcl.AstNode.AstNodeUtils;
import mcl.AstNode.AstNodeIds;
import mcl.Parser.Errors;
import js.Syntax;
import mcl.AstNode.JsonTagType;
import mcl.Tokenizer.PosInfo;
import js.Lib;
import haxe.io.Path;
import mcl.args.TemplateArgument;

class ErrorUtil {
	public static function format(message:String, pos:PosInfo):String {
		return '${pos.file}:${pos.line}:${pos.col + 1}: ${message}';
	}

	public static function formatWithStack(message:String, stack:Array<PosInfo>):String {
		var res = message;
		for (pos in stack) {
			res += '\n\tat ${pos.file}:${pos.line}:${pos.col + 1}';
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

private class UidTracker {
	private var uid:Int = 0;

	public function new() {}

	public function get():Int {
		return uid++;
	}
}

class McTemplate {
	private var name:String;
	private var body:Array<AstNode>;
	private var overloads:Map<Array<TemplateArgument>, Array<AstNode>> = new Map();
	private var installed:Bool = false;
	private var loadBlock:Null<Array<AstNode>> = null;
	private var tickBlock:Null<Array<AstNode>> = null;
	private var file:McFile;
	private var hasBeenUsed = false;

	public function new(name:String, body:Array<AstNode>, file:McFile) {
		this.name = name;
		this.body = body;
		this.parse(body);
		this.file = file;
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
					overloads.set(compileArgs(args, pos), body);
				case LoadBlock(pos, body):
					if (loadBlock == null)
						loadBlock = body;
					else
						throw new CompilerError(ErrorUtil.format("Templates can only have one top-level load block", pos));
				case TickBlock(pos, body):
					if (tickBlock == null)
						tickBlock = body;
					else
						throw new CompilerError(ErrorUtil.format("Templates can only have one top-level tick block", pos));
				case _ if (Type.enumIndex(node) == AstNodeIds.Comment):
				// ignore comments on the top level, they are allowed but have no output
				default:
					throw new CompilerError(ErrorUtil.format("Unexpected node type: " + Std.string(node), Reflect.field(node, 'pos')));
			}
		}
	}

	private function inject(context:CompilerContext, into:McFile) {
		this.hasBeenUsed = true;
		var defs:Array<AstNode> = [];
		if (loadBlock != null && loadBlock.length > 0) {
			var pos = AstNodeUtils.getPos(loadBlock[0]);
			defs.push(AstNode.FunctionDef(pos, "load", cast loadBlock, "load"));
		}
		if (tickBlock != null && tickBlock.length > 0) {
			var pos = AstNodeUtils.getPos(tickBlock[0]);
			defs.push(AstNode.FunctionDef(pos, "tick", cast tickBlock, "tick"));
		}
		if (defs.length > 0) {
			var pos = AstNodeUtils.getPos(defs[0]);
			var info = context.compiler.getInitialPathInfo(this.file.name);
			into.embed({
				append: function(v) {
					throw new CompilerError(ErrorUtil.formatContext("tried to append to a Void context (template virtual context)", pos, context));
				},
				namespace: info.namespace,
				path: info.path,
				uidIndex: context.uidIndex,
				variables: new VariableMap(context.globalVariables),
				templates: this.file.templates,
				stack: context.stack,
				replacements: new VariableMap(null),
				isTemplate: false,
				requireTemplateKeyword: true,
				compiler: context.compiler,
				globalVariables: context.globalVariables,
				functions: context.functions,
				baseNamespaceInfo: context.baseNamespaceInfo,
				currentFunction: context.currentFunction
			}, pos, new Map(), [AstNode.Directory(pos, this.name, defs)], true);
		}
	}

	var jsValueCache:IntMap<Any> = new IntMap();

	public function process(file:McFile, context:CompilerContext, pos:PosInfo, value:String, extras:Null<Array<AstNode>>) {
		var argstring = StringTools.ltrim(value.substring(this.name.length));
		jsValueCache.clear();
		TemplateArgument.jsCache = jsValueCache;
		for (types => overloadBody in overloads) {
			var args:Map<String, Any> = new Map();
			var successCount = 0;
			var pidx = 0;
			var argList:Array<Any> = [argstring].concat(extras == null ? [] : cast extras);
			var lastEntryWasBlock = false;
			var jsCacheIdx = 0;
			for (arg in types) {
				while (pidx < argList.length && argList[pidx] == "")
					pidx++;
				if (pidx >= argList.length)
					break; // this is a failure case as we are looking for more arguments but have run out
				if (arg.expectBlock) {
					if (!Type.enumEq(Type.typeof(argList[pidx]), TEnum(AstNode)))
						break; // this is a failure case as we are looking for a block but have something else
					var x = arg.parseValueBlock(argList[pidx], pos, context);
					if (!x.success) {
						break;
					}
					lastEntryWasBlock = true;
					args.set(arg.name, x.value);
					argList[pidx] = x.raw;
					successCount++;
					pidx++;
				} else {
					if (Syntax.typeof(argList[pidx]) != 'string')
						break; // this is a failure case as we are looking for a string but have something else
					var s:String = cast argList[pidx];
					var jsBlockRaw:String = null;
					if (s.charAt(0) == "<" && s.charAt(1) == "%" && !arg.expectJsValue) {
						var end = s.indexOf("%>");
						if (end == -1)
							throw new CompilerError(ErrorUtil.formatContext("Unexpected end of inline script block", pos, context));
						var script = s.substring(2, end);
						jsBlockRaw = script;
						if (jsValueCache.exists(jsCacheIdx)) {
							var jsVal = jsValueCache.get(jsCacheIdx);
							s = Std.string(jsVal);
						} else {
							var jsVal = McFile.invokeExpressionInline(script, context, pos);
							jsValueCache.set(jsCacheIdx, jsVal);
							s = Std.string(jsVal);
						}
						jsCacheIdx++;
					} else if (arg.expectJsValue) {
						TemplateArgument.jsCacheIdx = jsCacheIdx;
						jsCacheIdx++;
					}

					var x = arg.parseValue(s, pos, context);
					if (!x.success)
						break;
					if (arg.name != null)
						args.set(arg.name, x.value);
					if (jsBlockRaw != null) {
						argList[pidx] = StringTools.ltrim(cast(argList[pidx], String).substring(jsBlockRaw.length + 4));
					} else {
						argList[pidx] = StringTools.ltrim(cast(argList[pidx], String).substring(x.raw.length));
					}
					successCount++;
					lastEntryWasBlock = false;
				}
			}
			while (pidx < argList.length && argList[pidx] == "")
				pidx++;
			if (successCount != types.length || pidx != argList.length || (argList[pidx - 1] != "" && !lastEntryWasBlock))
				continue;
			if (!this.hasBeenUsed)
				this.inject(context, file);
			var newContext:CompilerContext = {
				append: context.append,
				namespace: context.namespace,
				path: context.path,
				uidIndex: context.uidIndex,
				variables: context.variables,
				templates: this.file.templates,
				stack: context.stack,
				replacements: context.replacements,
				isTemplate: false,
				requireTemplateKeyword: true,
				compiler: context.compiler,
				globalVariables: context.globalVariables,
				functions: context.functions,
				baseNamespaceInfo: context.baseNamespaceInfo,
				currentFunction: context.currentFunction
			};
			file.embed(newContext, pos, args, overloadBody);
			// trace("MATCHED", types, args);
			return;
		}
		throw new CompilerError("Failed to find matching template overload for: " + value);
	}
}

class VariableMap {
	var parent:Null<VariableMap>;
	var variables:Map<String, Any>;
	private var _cache:Null<Map<String, Any>>;

	public static var globals:VariableMap = new VariableMap(null, Globals.map);

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

	@:keep
	public static function fromObject(obj:Any):VariableMap {
		var res = new Map();
		for (k in Reflect.fields(obj)) {
			res.set(k, Reflect.field(obj, k));
		}
		return new VariableMap(null, res);
	}
}

typedef BaseNameInfo = {
	var namespace:String;
	var path:Array<String>;
};

typedef CompilerContext = {
	var append:String->Void;
	var namespace:String;
	var path:Array<String>;
	var uidIndex:UidTracker;
	var variables:VariableMap;
	var replacements:VariableMap;
	var stack:Array<PosInfo>;
	var isTemplate:Bool;
	var templates:Map<String, McTemplate>;
	var requireTemplateKeyword:Bool;
	var compiler:Compiler;
	var globalVariables:VariableMap;

	// list of function ids
	var functions:Array<String>;
	// pathlike array of the current function
	var currentFunction:Null<Array<String>>;
	var baseNamespaceInfo:BaseNameInfo;
};

enum ImportFileType {
	IMcFile(f:McFile);
	IJsFile(f:Any);
}

class McFile {
	public var name:String;

	public var existingDirectories:Map<String, Bool> = new Map();

	private var ast:Array<AstNode> = [];

	public var templates:Map<String, McTemplate> = new Map();

	private var exportedTemplates:Map<String, McTemplate> = new Map();
	private var imports:Map<String, McFile> = new Map();
	private var ext:String;
	private var loadCommands:Array<String> = [];
	private var tickCommands:Array<String> = [];
	private var fileJs:Any = {};

	public function new(name:String, ast:Array<AstNode>) {
		this.name = name;
		this.ast = ast;
		this.ext = Path.extension(name);
	}

	public function getTemplates():Map<String, McTemplate> {
		if (this.ext == "mcbt") {
			return exportedTemplates;
		}
		throw new CompilerError("tried to get templates from non-template file:" + this.name);
	}

	public function setup(compiler:Compiler) {
		var ast = this.ast;
		this.ast = [];
		for (node in ast) {
			switch (node) {
				case Import(_, importName):
					var res = compiler.resolve(this.name, importName);
					switch (res) {
						case IMcFile(f):
							imports.set(importName, f);
						case IJsFile(f):
							Syntax.code('Object.assign({0}, {1});', this.fileJs, f);
					}
				case TemplateDef(_, name, body):
					var template = new McTemplate(name, body, this);
					templates.set(name, template);
					exportedTemplates.set(name, template);
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

	public inline function forkCompilerContextWithAppend(context:CompilerContext, append:String->Void, functions:Array<String>):CompilerContext {
		return createCompilerContext(context.namespace, append, context.variables, context.path, context.uidIndex, context.stack, context.replacements,
			context.templates, context.requireTemplateKeyword, context.compiler, context.globalVariables, functions, context.baseNamespaceInfo,
			context.currentFunction);
	}

	private inline function createCompilerContext(namespace:String, append:String->Void, variableMap:VariableMap, path:Array<String>, uidIndex:UidTracker,
			stack:Array<PosInfo>, replacements:VariableMap, templates:Map<String, McTemplate>, requireTemplateKeyword:Bool, compiler:Compiler,
			globalVariables:VariableMap, functions:Array<String>, baseNameInfo:BaseNameInfo, currentFunction:Null<Array<String>>):CompilerContext {
		return {
			append: append,
			namespace: namespace,
			path: path == null ? [] : path,
			uidIndex: uidIndex,
			variables: variableMap,
			stack: stack,
			replacements: replacements,
			isTemplate: this.ext == "mcbt",
			templates: templates,
			requireTemplateKeyword: requireTemplateKeyword,
			compiler: compiler,
			globalVariables: globalVariables,
			functions: functions,
			baseNamespaceInfo: baseNameInfo,
			currentFunction: currentFunction
		};
	}

	private inline function saveContent(context:CompilerContext, path:String, content:String) {
		if (context.compiler.config.header.length > 0 && StringTools.endsWith(path, ".mcfunction")) {
			content = context.compiler.config.header + "\n" + content;
		}
		context.compiler.io.write(path, content);
	}

	public function createAnonymousFunction(pos:PosInfo, body:Array<AstNode>, data:Null<String>, context:CompilerContext, name:Null<String> = null):String {
		var commands:Array<String> = [];
		var uid = name == null ? Std.string(context.uidIndex.get()) : "";
		var id = name == null ? '${context.compiler.config.generatedDirName}/${uid}' : name;
		var callSig = context.namespace + ":" + context.path.concat(name == null ? [context.compiler.config.generatedDirName, uid] : [name]).join("/");
		var newContext = createCompilerContext(context.namespace, v -> {
			commands.push(v);
		},
			context.variables.fork(), context.path.concat([context.compiler.config.generatedDirName]), context.uidIndex, context.stack, context.variables,
			context.templates, context.requireTemplateKeyword, context.compiler, context.globalVariables, context.functions.concat([callSig]),
			context.baseNamespaceInfo, context.currentFunction);
		for (node in body) {
			compileCommand(node, newContext);
		}
		var result = commands.join("\n");
		if (name != null)
			name = injectValues(name, context, pos);
		saveContent(context, Path.join(['data', context.namespace, 'functions'].concat(context.path.concat([id + ".mcfunction"]))), result);
		return 'function ${context.namespace}:${context.path.concat([id]).join("/")}' + (data == null ? '' : ' $data');
	}

	public function embed(context:CompilerContext, pos:PosInfo, varmap:Map<String, Any>, body:Array<AstNode>, useTld:Bool = false) {
		var newContext = createCompilerContext(context.namespace, context.append,
			new VariableMap(VariableMap.globals, context.globalVariables.fork(varmap).get()), context.path, context.uidIndex, context.stack,
			context.replacements, context.templates, context.requireTemplateKeyword, context.compiler, context.globalVariables, context.functions,
			context.baseNamespaceInfo, context.currentFunction);
		for (node in body) {
			if (useTld) {
				compileTld(node, newContext);
			} else {
				compileCommand(node, newContext);
			}
		}
	}

	private function processTemplate(context:CompilerContext, pos:PosInfo, value:String, extras:Null<Array<AstNode>>) {
		if (StringUtils.startsWithConstExpr(value, "template ")) {
			value = value.substring(9);
		}
		for (k => v in context.templates) {
			if (value == k || StringTools.startsWith(value, k)) {
				// trace(this, context, pos, value, extras);
				v.process(this, context, pos, value, extras);
				return;
			}
		}
		if (extras != null && extras.length > 0) {
			throw new CompilerError(ErrorUtil.formatContext("Unexpected extra data in non template command", pos, context));
		}
		context.append(injectValues(value, context, pos));
	}

	private function compileInline(context:CompilerContext, code:String) {
		var tokens = Tokenizer.tokenize(code, '<inline ${this.name}>');
		var tokenInput = new TokenInput(tokens);
		var astNodes:Array<AstNode> = [];
		while (tokenInput.hasNext()) {
			astNodes.push(Parser.innerParse(tokenInput));
		}
		for (node in astNodes)
			this.compileCommand(node, context);
	}

	private function processMlScript(context:CompilerContext, pos:PosInfo, tokens:Array<Token>) {
		var str = "";
		for (t in tokens) {
			switch (t) {
				case Literal(v, pos):
					str += v + "\n";
				case BracketOpen(pos, data):
					str += '{${data}';
				case BracketClose(pos):
					str += '}';
			}
		}
		var names:Array<String> = ['emit', 'context', "embed", "require"];
		var emit = (c:String) -> context.append(c);
		function emitMcb(code:String) {
			this.compileInline(context, code);
		}
		function emitBlock(commands:Array<String>, ?data:String) {
			var id = '${context.compiler.config.generatedDirName}/${Std.string(context.uidIndex.get())}';
			saveContent(context, Path.join(['data', context.namespace, 'functions'].concat(context.path.concat([id + ".mcfunction"]))), commands.join("\n"));
			var signature = '${context.namespace}:${context.path.concat([id]).join("/")}';
			context.append('function $signature' + (data == null ? '' : ' $data'));
			return signature;
		}
		untyped {
			emit.mcb = emitMcb;
			emit.block = emitBlock;
		}
		var values:Array<Any> = [
			emit,
			context,
			function(v) {
				return v.embedTo(context, pos, this);
			},
			#if !disableRequire
			Module.createRequire(this.name)
			#else
			(s) -> {
				throw new CompilerError("Require not available in this build of mcl.Compiler, please compile without the disableRequire flag set");
			}
			#end
		];
		var jsEnv = context.variables.get();
		for (k => v in jsEnv) {
			names.push(k);
			values.push(v);
		}
		try {
			Syntax.code('new Function(...{0},{1})(...{2})', names, str, values);
		} catch (e) {
			if (Syntax.instanceof(e, McbError)) {
				throw e;
			} else {
				throw new CompilerError(ErrorUtil.formatContext('Error in multi-line script, \'${e.message}\' at ${pos.file}:${pos.line}:${pos.col + 1}', pos,
					context));
			}
		}
	}

	private function compileCommand(node:AstNode, context:CompilerContext):Void {
		switch (node) {
			case MultiLineScript(pos, value):
				processMlScript(context, pos, value);
			case Raw(pos, value, extras):
				processTemplate(context, pos, value, extras);
			case Comment(_, value):
				context.append(value);
			case AstNode.Block(pos, null, body, data) | AstNode.Block(pos, "", body, data):
				context.append(createAnonymousFunction(pos, body, data, context));
			case CompileTimeIf(pos, expression, body, elseExpressions):
				compileTimeIf(expression, body, elseExpressions, pos, context, (v) -> {
					compileCommand(v, context);
				});
			case EqCommand(pos, command):
				var res = McMath.compile(command, context);
				context.append(res.commands);
				var addScoreboardCommand = 'scoreboard objectives add ${context.compiler.config.eqConstScoreboardName} dummy';
				if (!this.loadCommands.contains(addScoreboardCommand)) {
					this.loadCommands.push(addScoreboardCommand);
				}
				addScoreboardCommand = 'scoreboard objectives add ${context.compiler.config.eqVarScoreboardName} dummy';
				if (!this.loadCommands.contains(addScoreboardCommand)) {
					this.loadCommands.push(addScoreboardCommand);
				}
				for (k in res.constants) {
					var cmd = 'scoreboard players set $k ${context.compiler.config.eqConstScoreboardName} $k';
					if (!this.loadCommands.contains(cmd)) {
						this.loadCommands.push(cmd);
					}
				}
			case ScheduleCall(pos, delay, name, mode):
				js.Lib.debug();
				switch (name.charAt(0)) {
					case "^": // hiarchial function call
						var levels = Std.parseInt(name.substring(1));
						var fn = context.functions[context.functions.length - levels - 1];
						if (fn == null) {
							throw new CompilerError(ErrorUtil.formatContext("Unexpected schedule call: " + name, pos, context));
						}
						context.append(injectValues('schedule function ${fn} ${delay} ${mode}', context, pos));
					case "*": // root function call
						context.append(injectValues('schedule function ${context.namespace}:${name.substring(1)} ${delay} ${mode}', context, pos));
					case ".":
						if (name.charAt(1) == "/" || name.charAt(1) == "." && name.charAt(2) == "/") {
							var path = context.currentFunction.concat(name.split("/"));
							var resolved:Array<String> = [];
							for (node in path) {
								switch (node) {
									case "..":
										if (resolved.length == 0)
											throw new CompilerError(ErrorUtil.formatContext("Invalid schedule call: " + name, pos, context));
										resolved.pop();
									case "." | "":
									// ignore
									default:
										resolved.push(node);
								}
							}
							context.append(injectValues('schedule function ${context.namespace}:${resolved.join("/")} ${delay} ${mode}', context, pos));
						} else {
							context.append(injectValues('schedule function ${name} ${delay} ${mode}', context, pos));
						}
					default:
						context.append(injectValues('schedule function ${name} $delay $mode', context, pos));
				}
			case ScheduleBlock(pos, delay, type, body):
				var commands:Array<String> = [];
				var append = function(command:String) {
					commands.push(command);
				};
				var uid = Std.string(context.uidIndex.get());
				var callSignature = '${context.namespace}:${context.path.concat([context.compiler.config.generatedDirName, uid]).join("/")}';
				var newContext = forkCompilerContextWithAppend(context, append, context.functions.concat([callSignature]));
				for (node in body) {
					compileCommand(node, newContext);
				}
				var result = commands.join("\n");
				var id = Std.string(context.uidIndex.get());
				saveContent(context,
					Path.join(['data', context.namespace, 'functions'].concat(context.path.concat([context.compiler.config.generatedDirName, id + ".mcfunction"]))),
					result);
				context.append('schedule function ${context.namespace}:${context.path.concat([context.compiler.config.generatedDirName, id]).join("/")} $delay $type');
			case FunctionCall(pos, name, data):
				name = injectValues(name, context, pos);
				// sanity check * and . calls
				// support scripting
				// testcases
				switch (name.charAt(0)) {
					case "^": // hiarchial function call
						var levels = Std.parseInt(name.substring(1));
						var fn = context.functions[context.functions.length - levels - 1];
						if (fn == null) {
							throw new CompilerError(ErrorUtil.formatContext("Unexpected function call: " + name, pos, context));
						}
						context.append(injectValues('function ${fn}${data.length == 0 ? '' : ' $data'}', context, pos));
					case "*": // root function call
						context.append(injectValues('function ${context.namespace}:${name.substring(1)}${data.length == 0 ? '' : ' $data'}', context, pos));
					case ".":
						if (name.charAt(1) == "/" || name.charAt(1) == "." && name.charAt(2) == "/") {
							var path = context.currentFunction.concat(name.split("/"));
							var resolved:Array<String> = [];
							for (node in path) {
								switch (node) {
									case "..":
										if (resolved.length == 0)
											throw new CompilerError(ErrorUtil.formatContext("Invalid function call: " + name, pos, context));
										resolved.pop();
									case "." | "":
									// ignore
									default:
										resolved.push(node);
								}
							}
							context.append(injectValues('function ${context.namespace}:${resolved.join("/")}${data.length == 0 ? '' : ' $data'}', context,
								pos));
						} else {
							context.append(injectValues('function ${name}${data.length == 0 ? '' : ' $data'}', context, pos));
						}
					default:
						context.append(injectValues('function ${name}${data.length == 0 ? '' : ' $data'}', context, pos));
				}
			case Execute(pos, command, value):
				var commands:Array<String> = [];
				var uid = Std.string(context.uidIndex.get());
				var callSignature = '${context.namespace}:${context.path.concat([context.compiler.config.generatedDirName, uid]).join("/")}';
				var newContext = forkCompilerContextWithAppend(context, v -> {
					commands.push(v);
				}, context.functions.concat([callSignature]));
				compileCommand(value, newContext);
				if (commands.length == 0) {
					throw new CompilerError(ErrorUtil.formatContext("Unexpected empty execute", pos, context));
				}
				if (commands.length == 1 && commands[0].indexOf(callSignature) == -1) {
					context.append(injectValues('$command ${commands[0]}', context, pos));
				} else {
					var id = uid;
					var path = Path.join(['data', context.namespace, 'functions'].concat(context.path.concat([context.compiler.config.generatedDirName, id
						+ ".mcfunction"])));
					saveContent(context, path, commands.join("\n"));
					context.append(injectValues('$command function ${context.namespace}:${context.path.concat([context.compiler.config.generatedDirName, id]).join("/")}',
						context,
						pos));
				}
			case ExecuteBlock(pos, execute, data, body, continuations):
				var commands:Array<String> = [];
				var append = function(command:String) {
					commands.push(command);
				};
				var uid = Std.string(context.uidIndex.get());
				var callSignature = '${context.namespace}:${context.path.concat([context.compiler.config.generatedDirName, uid]).join("/")}';
				var newContext:CompilerContext = forkCompilerContextWithAppend(context, append, context.functions.concat([callSignature]));
				for (node in body) {
					compileCommand(node, newContext);
				}
				var result = commands.join("\n");
				var id = Std.string(context.uidIndex.get());
				saveContent(context,
					Path.join(['data', context.namespace, 'functions'].concat(context.path.concat([context.compiler.config.generatedDirName, id + ".mcfunction"]))),
					result);
				if (continuations != null) {
					context.append('scoreboard players set #ifelse ${context.compiler.config.internalScoreboardName} 0');
					context.append(injectValues('execute store success score #ifelse ${context.compiler.config.internalScoreboardName}${execute.substring(7)} function ${context.namespace}:${context.path.concat([context.compiler.config.generatedDirName, id]).join("/")}'
						+ (data == null ? '' : ' $data'),
						context, pos));
				} else {
					context.append(injectValues('$execute function ${context.namespace}:${context.path.concat([context.compiler.config.generatedDirName, id]).join("/")}'
						+ (data == null ? '' : ' $data'),
						context, pos));
				}
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
								var id = Std.string(context.uidIndex.get());
								var callSignature = '${context.namespace}:${context.path.concat([context.compiler.config.generatedDirName, id]).join("/")}';
								var embedContext = forkCompilerContextWithAppend(context, embedAppend, context.functions.concat([callSignature]));

								for (node in body) {
									compileCommand(node, embedContext);
								}
								var result = embedCommands.join("\n");

								saveContent(context,
									Path.join(['data', context.namespace, 'functions'].concat(context.path.concat([context.compiler.config.generatedDirName, id
										+ ".mcfunction"]))),
									result);

								var executeCommandArgs = StringUtils.startsWithConstExpr(execute, "execute ") ? execute.substring(8) : execute;
								context.append('execute if score #ifelse ${context.compiler.config.internalScoreboardName} matches 0 ${isDone ? '' : 'store success score #ifelse ${context.compiler.config.internalScoreboardName} '}$executeCommandArgs function ${context.namespace}:${context.path.concat([context.compiler.config.generatedDirName, id]).join("/")}'
									+ (data == null ? '' : ' $data'));
							case Block(_, _, body, data):
								var embedCommands:Array<String> = [];
								if (!isDone)
									throw new CompilerError("block continuation must be the last continuation", true);
								var appendEmbed = function(command:String) {
									embedCommands.push(command);
								};
								var id = Std.string(context.uidIndex.get());
								var callSignature = '${context.namespace}:${context.path.concat([context.compiler.config.generatedDirName, id]).join("/")}';
								var embedContext = forkCompilerContextWithAppend(context, appendEmbed, context.functions.concat([callSignature]));
								for (node in body) {
									compileCommand(node, embedContext);
								}
								var result = embedCommands.join("\n");
								saveContent(context,
									Path.join(['data', context.namespace, 'functions'].concat(context.path.concat([context.compiler.config.generatedDirName, id
										+ ".mcfunction"]))),
									result);
								context.append('execute if score #ifelse ${context.compiler.config.internalScoreboardName} matches 0 run function ${context.namespace}:${context.path.concat([context.compiler.config.generatedDirName, id]).join("/")}'
									+ (data == null ? '' : ' $data'));

							default: throw new CompilerError(ErrorUtil.formatContext("Unexpected continuation type: " + Std.string(continuation),
									AstNodeUtils.getPos(continuation), newContext));
						}
						idx++;
					}
				}

			case CompileTimeLoop(pos, expression, as, body):
				processCompilerLoop(expression, as, context, body, pos, (context, v) -> {
					return compileCommand(v, context);
				});
			case Block(pos, name, body, data):
				context.append(createAnonymousFunction(pos, body, data, context, name));
			case LoadBlock(pos, body):
				var newContext = forkCompilerContextWithAppend(context, v -> {
					loadCommands.push(v);
				}, context.functions.concat([null]));
				for (node in body) {
					compileCommand(node, newContext);
				}
			case TickBlock(pos, body):
				var newContext = forkCompilerContextWithAppend(context, v -> {
					tickCommands.push(v);
				}, context.functions.concat([null]));
				for (node in body) {
					compileCommand(node, newContext);
				}
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
		var funcId = context.namespace + ":" + context.path.concat([name]).join("/");
		var newContext = forkCompilerContextWithAppend(context, append, context.functions.concat([funcId]));
		newContext.currentFunction = context.path;
		for (node in body) {
			compileCommand(node, newContext);
		}

		if (appendTo != null) {
			if (appendTo == "load") {
				context.compiler.tags.addLoadingCommand(funcId);
			} else if (appendTo == "tick") {
				context.compiler.tags.addTickingCommand(funcId);
			} else {
				throw new CompilerError("unexpected appendTo value: " + appendTo, true);
			}
		}
		saveContent(context, Path.join(['data', context.namespace, 'functions'].concat(context.path.concat([name + ".mcfunction"]))), commands.join("\n"));
	}

	private function compileDirectory(pos:PosInfo, name:String, body:Array<AstNode>, context:CompilerContext) {
		name = injectValues(name, context, pos);
		var newContext = createCompilerContext(context.namespace, v -> {
			throw new CompilerError("append not available for directory context", true);
		},
			context.variables, context.path.concat([name]), new UidTracker(), context.stack, context.replacements, context.templates,
			context.requireTemplateKeyword, context.compiler, context.globalVariables, context.functions, context.baseNamespaceInfo, context.currentFunction);
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
			case JsonFile(pos, name, info):
				compileJsonFile(pos, name, info, context);
			case CompileTimeLoop(pos, expression, as, body):
				processCompilerLoop(expression, as, context, body, pos, (context, v) -> {
					return compileTld(v, context);
				});
			case CompileTimeIf(pos, expression, body, elseExpressions):
				compileTimeIf(expression, body, elseExpressions, pos, context, (v) -> {
					compileTld(v, context);
				});
			case ClockExpr(pos, name, time, body):
				var commands:Array<String> = [];
				var newContext = forkCompilerContextWithAppend(context, v -> {
					commands.push(v);
				}, context.functions);

				var id = Std.string(context.uidIndex.get());
				var path = (name == null ? context.path.concat([context.compiler.config.generatedDirName, '$id']) : context.path.concat([name])).join("/");
				var functionId = context.namespace + ":" + path;
				commands.push('schedule function $functionId $time replace');
				for (node in body) {
					compileCommand(node, newContext);
				}
				var result = commands.join("\n");
				saveContent(context, Path.join(['data', context.namespace, 'functions', '$path.mcfunction']), result);
				context.compiler.tags.addLoadingCommand(functionId);
			case Comment(_, _):
			// ignore comments on the top level, they are allowed but have no output
			default:
				throw new CompilerError("unexpected node type:" + Std.string(node), true);
		}
	}

	function compileJsonFile(pos:PosInfo, name:String, info:JsonTagType, context:CompilerContext) {
		switch (info) {
			case Tag(subType, replace, entries):
				var data = Json.stringify({
					replace: replace,
					values: [
						for (e in entries) {
							switch (e) {
								case Raw(pos, value, []) | Comment(pos, value):
									if (value.indexOf(" ") != -1 && StringTools.endsWith(value, " replace")) {
										cast {
											id: value.substring(0, value.length - 8),
											replace: true
										}
									} else if (value.indexOf(" ") != -1) {
										throw new CompilerError(ErrorUtil.formatContext("Malformed tag entry", pos, context));
									} else {
										cast value;
									}
								default:
									throw new CompilerError(ErrorUtil.formatContext("Unexpected node type in json tag", pos, context));
							}
						}
					]
				});
				saveContent(context, Path.join(['data', context.namespace, 'tags', subType].concat(context.path.concat([name + ".json"]))), data);
			case Advancement(entries) | ChatType(entries) | DamageType(entries) | Dimension(entries) | DimensionType(entries) | ItemModifier(entries) |
				LootTable(entries) | Predicate(entries) | Recipe(entries):
				var values = '{${stringifyJsonTag(pos, name, entries, context)}}';
				var type = switch (info) {
					case Advancement(_):
						"advancements";
					case ChatType(_):
						"chat";
					case DamageType(_):
						"damage";
					case Dimension(_):
						"dimension";
					case DimensionType(_):
						"dimension_type";
					case ItemModifier(_):
						"item_modifiers";
					case LootTable(_):
						"loot_tables";
					case Predicate(_):
						"predicates";
					case Recipe(_):
						"recipes";
					case _:
						throw new CompilerError("unexpected json tag type:" + Std.string(info), true);
				};
				saveContent(context, Path.join(['data', context.namespace, type].concat(context.path.concat([name + ".json"]))), values);
			case WorldGen(subType, name, entries):
				var values = '{${stringifyJsonTag(pos, name, entries, context)}}';
				saveContent(context, Path.join(['data', context.namespace, 'worldgen', subType].concat(context.path.concat([name + ".json"]))), values);
		}
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
					context.stack, context.variables, context.templates, context.requireTemplateKeyword, context.compiler, context.globalVariables,
					context.functions, context.baseNamespaceInfo, context.currentFunction);
				for (node in body) {
					handler(newContext, node);
				}
			}
		}
	}

	function stringifyJsonTag(pos:PosInfo, name:String, value:Array<AstNode>, context:CompilerContext) {
		name = injectValues(name, context, pos);
		var values:Array<String> = [];
		var newContext = forkCompilerContextWithAppend(context, v -> values.push(v), context.functions);
		for (v in value) {
			switch (v) {
				case Raw(pos, value, extra):
					if (extra != null && extra.length > 0) {
						throw new CompilerError(ErrorUtil.formatContext("Unexpected extra data in json tag", pos, context));
					}
					values.push(injectValues(value, context, pos));
				case CompileTimeLoop(pos, expression, as, body):
					processCompilerLoop(expression, as, context, body, pos, (context, v) -> {
						return compileCommand(v, context);
					});
				case CompileTimeIf(pos, expression, body, elseExpression):
					compileTimeIf(expression, body, elseExpression, pos, newContext, (v) -> {
						compileCommand(v, context);
					});
				default:
					throw new CompilerError("unexpected node type:" + Std.string(v), true);
			}
		}

		return values.join('');
	}

	function injectValues(target:String, context:CompilerContext, pos:PosInfo):String {
		if (target.indexOf("<%") == -1)
			return target;
		var variables = context.variables.get();
		var argList:Array<String> = ['embed', 'context'];
		var valueList:Array<Any> = [
			function(v) {
				return v.embedTo(context, pos, this);
			},
			context
		];
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
			throw new CompilerError(Parser.format(Errors.ErrorWhilstEvaluatingExpression, e.message, pos.file, pos.line, pos.col + 1));
		}
	}

	public static function invokeExpressionInline(expression:String, context:CompilerContext, pos:PosInfo):Any {
		var variables = context.variables.get();
		var argList:Array<String> = ['context'];
		var valueList:Array<Any> = [context];
		for (k => v in variables) {
			argList.push(k);
			valueList.push(v);
		}
		var code = 'return ($expression);';
		try {
			return Syntax.code('new Function(...{1},{0}).apply(null, {2});', code, argList, valueList);
		} catch (e) {
			// TODO: make this more specific to the code being run.
			throw new CompilerError(Parser.format(Errors.ErrorWhilstEvaluatingExpression, e.message, pos.file, pos.line, pos.col + 1));
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

	public function compile(vars:VariableMap, compiler:Compiler) {
		var info = compiler.getInitialPathInfo(this.name);
		var thisFileVars = new VariableMap(vars, [
			for (k in Reflect.fields(this.fileJs))
				k => Reflect.field(this.fileJs, k)
		]);
		var context = createCompilerContext(info.namespace, v -> {
			throw new CompilerError("append not available for top-level context", true);
		},
			new VariableMap(thisFileVars, Globals.map), info.path, new UidTracker(), [], new VariableMap(null, []), templates, this.ext == "mcbt", compiler,
			thisFileVars, [], info, null);
		if (context.isTemplate) {
			if (ast.length > 0) {
				throw new CompilerError(ErrorUtil.formatContext("Unexpected top-level content in template file", AstNodeUtils.getPos(ast[0]), context));
			}
			return;
		}
		for (node in ast) {
			switch (node) {
				case Import(_, _) | TemplateDef(_, _, _):
					throw new CompilerError("import or template definition found after setup", true);
				default:
					compileTld(node, context);
			}
		}
		if (loadCommands.length > 0) {
			saveContent(context,
				Path.join(['data', context.namespace, 'functions'].concat(context.path.concat([context.compiler.config.generatedDirName, 'load.mcfunction']))),
				loadCommands.join("\n"));
			compiler.tags.addLoadingCommand(context.namespace + ":" + context.path.concat([context.compiler.config.generatedDirName, 'load']).join("/"));
		}
		if (tickCommands.length > 0) {
			saveContent(context,
				Path.join(['data', context.namespace, 'functions'].concat(context.path.concat([context.compiler.config.generatedDirName, 'tick.mcfunction']))),
				tickCommands.join("\n"));
			compiler.tags.addTickingCommand(context.namespace + ":" + context.path.concat([context.compiler.config.generatedDirName, 'tick']).join("/"));
		}
	}
}

@:expose
class Compiler {
	public var io:Io = new Io.SyncIo();

	private var files:Map<String, McFile> = new Map();
	private var alreadySetupFiles = new Map<String, Bool>();
	private var libStore:Null<LibStore> = null;

	public var baseDir:String;
	public var tags:TagManager = new TagManager();
	public var packNamespace:String = 'mcb-${Date.now()}';
	public var config:Config = Config.create(cast {});

	public function addFile(name:String, ast:Array<AstNode>) {
		var file = new McFile(name, ast);
		files.set(name, file);
	}

	public function resolve(baseFile:String, resolutionPath:String):ImportFileType {
		if (resolutionPath.charAt(0) == ".") {
			var base = Path.directory(baseFile);
			var resolved = Path.join([base, resolutionPath]);
			var ext = Path.extension(resolutionPath);
			if (StringTools.endsWith(ext, "js") || ext == "json") {
				return IJsFile(Syntax.code('require({0})', resolved));
			}
			if (files.exists(resolved)) {
				if (!alreadySetupFiles.exists(resolved)) {
					alreadySetupFiles.set(resolved, true);
					files.get(resolved).setup(this);
				}
				return IMcFile(files.get(resolved));
			}
			throw new CompilerError("Failed to resolve import: " + resolved);
		} else {
			return IMcFile(this.libStore.lookup(resolutionPath, {
				file: baseFile,
				line: 0,
				col: 0
			}, this));
		}
	}

	public function getInitialPathInfo(p:String):{
		namespace:String,
		path:Array<String>
	} {
		var projectPath = (StringTools.startsWith(p, this.baseDir) ? p.substring(this.baseDir.length) : p).split("\\").join("/");
		if (projectPath.charAt(0) == "/")
			projectPath = projectPath.substring(1);
		var parts = projectPath.split("/");
		var namespace = Path.withoutExtension(parts[0]);
		var path = parts.slice(1).join("/");
		return {
			namespace: namespace,
			path: parts.length > 1 ? Path.withoutExtension(path).split("/") : []
		};
	}

	public var success:Bool = true;

	public function compile(root:VariableMap) {
		success = true;
		try {
			for (file in files) {
				if (alreadySetupFiles.exists(file.name))
					continue;
				file.setup(this);
			}

			for (file in files) {
				file.compile(root, this);
			}
			tags.writeTagFiles(this);
		} catch (e:Dynamic) {
			success = false;
			// pass on error to the wrapping application
			throw e;
		}
	}

	public function new(baseDir:String, config:UserConfig, ?lib:LibStore) {
		this.config = Config.create(config);
		this.baseDir = baseDir;
		this.libStore = lib;
	}
}

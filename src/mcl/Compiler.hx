package mcl;

import js.html.SubtleCrypto;
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
						throw new CompilerError(ErrorUtil.format("Templates can only have one top-level load block", pos), false);
				case TickBlock(pos, body):
					if (tickBlock == null)
						tickBlock = body;
					else
						throw new CompilerError(ErrorUtil.format("Templates can only have one top-level tick block", pos), false);
				case _ if (Type.enumIndex(node) == AstNodeIds.Comment):
				// ignore comments on the top level, they are allowed but have no output
				default:
					throw new CompilerError(ErrorUtil.format("Unexpected node type: " + Std.string(node), Reflect.field(node, 'pos')), true);
			}
		}
	}

	private function inject(context:CompilerContext, into:McFile) {
		this.hasBeenUsed = true;
		var defs:Array<AstNode> = [];
		if (loadBlock != null && loadBlock.length > 0) {
			var pos = AstNodeUtils.getPos(loadBlock[0]);
			defs.push(AstNode.FunctionDef(pos, "load", cast loadBlock, "minecraft:load"));
		}
		if (tickBlock != null && tickBlock.length > 0) {
			var pos = AstNodeUtils.getPos(tickBlock[0]);
			defs.push(AstNode.FunctionDef(pos, "tick", cast tickBlock, "minecraft:tick"));
		}
		if (defs.length > 0) {
			var pos = AstNodeUtils.getPos(defs[0]);
			var info = context.compiler.getInitialPathInfo(this.file.name);
			into.embed({
				append: function(v) {
					throw CompilerError.create("tried to append to a Void context (template virtual context)", pos, context);
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
							throw CompilerError.create("Unexpected end of inline script block", pos, context);
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
		throw CompilerError.create("Failed to find matching template overload for: " + value, pos, context);
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

	private var functionsDir = "functions";
	private var tagsDir = "tags";

	public function new(name:String, ast:Array<AstNode>) {
		this.name = name;
		this.ast = ast;
		this.ext = Path.extension(name);
	}

	public function getTemplates():Map<String, McTemplate> {
		if (this.ext == "mcbt") {
			return exportedTemplates;
		}
		throw new CompilerError("tried to get templates from non-template file:" + this.name, true);
	}

	public function setup(compiler:Compiler) {
		if (compiler.config.features.useFolderRenames48) {
			functionsDir = "function";
		}
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

	public function createAnonymousFunction(pos:PosInfo, body:Array<AstNode>, data:Null<String>, context:CompilerContext, name:Null<String> = null,
			isMacro):String {
		name = name != null ? injectValues(name, context, pos) : null;
		var commands:Array<String> = [];
		var uid = name == null ? Std.string(context.uidIndex.get()) : "";
		var id = name == null ? '${context.compiler.config.generatedDirName}/${uid}' : name;
		var newGeneratedRoot = name == null ? [] : [name];
		if (name != null && name.indexOf("/") != -1) {
			var segments = name.split("/");
			segments.pop();
			newGeneratedRoot = segments;
		}
		var callSig = context.namespace + ":" + context.path.concat(name == null ? [context.compiler.config.generatedDirName, uid] : [name]).join("/");
		var newContext = createCompilerContext(context.namespace, v -> {
			commands.push(v);
		},
			context.variables.fork(), context.path.concat(newGeneratedRoot), context.uidIndex, context.stack, context.variables, context.templates,
			context.requireTemplateKeyword, context.compiler, context.globalVariables, context.functions.concat([callSig]), context.baseNamespaceInfo,
			context.currentFunction);
		for (node in body) {
			compileCommand(node, newContext);
		}
		var result = commands.join("\n");
		if (name != null)
			name = injectValues(name, context, pos);
		saveContent(context, Path.join(['data', context.namespace, functionsDir].concat(context.path.concat([id + ".mcfunction"]))), result);
		return makeMacro(isMacro, 'function ${context.namespace}:${context.path.concat([id]).join("/")}' + (data == null ? '' : ' $data'));
	}

	public inline function makeMacro(cond:Bool, cmd:String):String {
		return '${cond ? '$' : ''}${cmd}';
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

	private function processTemplate(context:CompilerContext, pos:PosInfo, value:String, extras:Null<Array<AstNode>>, isMacro:Bool) {
		if (context.compiler.templateParsingEnabled) {
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
				throw CompilerError.create("Unexpected extra data in non template command", pos, context);
			}
		}
		context.append(makeMacro(isMacro, injectValues(value, context, pos)));
	}

	private function compileInline(context:CompilerContext, code:String, isTLD:Bool = false) {
		var tokens = Tokenizer.tokenize(code, '<inline ${this.name}>');
		var tokenInput = new TokenInput(tokens);
		var astNodes:Array<AstNode> = [];
		while (tokenInput.hasNext()) {
			if (isTLD) {
				astNodes.push(Parser.parseTLD(tokenInput));
			} else {
				astNodes.push(Parser.innerParse(tokenInput));
			}
		}
		if (isTLD) {
			for (node in astNodes)
				this.compileTld(node, context);
		} else {
			for (node in astNodes)
				this.compileCommand(node, context);
		}
	}

	private function processMlScript(context:CompilerContext, pos:PosInfo, tokens:Array<Token>, isTLD = false) {
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
			this.compileInline(context, code, isTLD);
		}
		function emitBlock(commands:Array<String>, ?data:String) {
			var id = '${context.compiler.config.generatedDirName}/${Std.string(context.uidIndex.get())}';
			saveContent(context, Path.join(['data', context.namespace, functionsDir].concat(context.path.concat([id + ".mcfunction"]))), commands.join("\n"));
			var signature = '${context.namespace}:${context.path.concat([id]).join("/")}';
			context.append('function $signature' + (data == null ? '' : ' $data'));
			return signature;
		}
		untyped {
			emit.mcb = emitMcb;
			if (!isTLD)
				emit.block = emitBlock;
		}
		var values:Array<Any> = [
			emit,
			context,
			function(v) {
				if (isTLD)
					throw CompilerError.create("embed not available in toplevel script blocks", pos, context);
				return v.embedTo(context, pos, this);
			},
			#if !disableRequire
			context.compiler.disableRequire ?(s) -> {
				throw CompilerError.create("Require not available as it has been disabled, please disable compiler.disableRequire", pos, context);
			} : Module.createRequire(this.name)
			#else
			(s) -> {
				throw CompilerError.createInternal("Require not available in this build of mcl.Compiler, please compile without the disableRequire flag set",
					pos, context);
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
				throw CompilerError.create('Error in multi-line script, \'${e.message}\' at ${pos.file}:${pos.line}:${pos.col + 1}', pos, context);
			}
		}
	}

	private function compileCommand(node:AstNode, context:CompilerContext):Void {
		switch (node) {
			case MultiLineScript(pos, value):
				processMlScript(context, pos, value);
			case Raw(pos, value, extras, isMacro):
				processTemplate(context, pos, value, extras, isMacro);
			case Comment(_, value):
				if (!context.compiler.config.dontEmitComments)
					context.append(value);
			case AstNode.Block(pos, null, body, data, isMacro, isInline) | AstNode.Block(pos, "", body, data, isMacro, isInline):
				if (isInline) {
					if (data != null) {
						throw CompilerError.create("Inline block cannot have data", pos, context);
					} else {
						for (node in body) {
							compileCommand(node, context);
						}
					}
				} else {
					context.append(createAnonymousFunction(pos, body, data, context, null, isMacro));
				}
			case ReturnRun(pos, value, isMacro):
				var content:Array<String> = [];
				var newContext = forkCompilerContextWithAppend(context, v -> {
					content.push(v);
				}, context.functions);
				compileCommand(value, newContext);
				if (content.length != 1) {
					throw CompilerError.create('Expected exactly 1 command after return run, got ${content.length}', pos, context);
				}
				context.append(makeMacro(isMacro, 'return run ${content[0]}'));
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
			case ScheduleClear(pos, name, isMacro):
				var tagPrefix = name.charAt(0) == "#" ? "#" : "";
				if (tagPrefix != "") {
					name = name.substring(1);
				}
				switch (name.charAt(0)) {
					case "^": // hiarchial function call
						var levels = Std.parseInt(name.substring(1));
						var fn = context.functions[context.functions.length - levels - 1];
						if (fn == null) {
							throw CompilerError.create("Unexpected schedule call: " + name, pos, context);
						}
						context.append(injectValues(makeMacro(isMacro, 'schedule clear ${tagPrefix}${fn}'), context, pos));
					case "*": // root function call
						context.append(injectValues(makeMacro(isMacro, 'schedule clear ${tagPrefix}${context.namespace}:${name.substring(1)}'), context, pos));
					case ".":
						if (name.charAt(1) == "/" || name.charAt(1) == "." && name.charAt(2) == "/") {
							var path = context.currentFunction.concat(name.split("/"));
							var resolved:Array<String> = [];
							for (node in path) {
								switch (node) {
									case "..":
										if (resolved.length == 0)
											throw CompilerError.create("Invalid schedule call: " + name, pos, context);
										resolved.pop();
									case "." | "":
									// ignore
									default:
										resolved.push(node);
								}
							}
							context.append(injectValues(makeMacro(isMacro, 'schedule clear ${tagPrefix}${context.namespace}:${resolved.join("/")}'), context,
								pos));
						} else {
							context.append(injectValues(makeMacro(isMacro, 'schedule clear ${tagPrefix}${name}'), context, pos));
						}
					default:
						context.append(injectValues(makeMacro(isMacro, 'schedule clear ${tagPrefix}${name}'), context, pos));
				}
			case ScheduleCall(pos, delay, name, mode, isMacro):
				var tagPrefix = name.charAt(0) == "#" ? "#" : "";
				if (tagPrefix != "") {
					name = name.substring(1);
				}
				switch (name.charAt(0)) {
					case "^": // hiarchial function call
						var levels = Std.parseInt(name.substring(1));
						var fn = context.functions[context.functions.length - levels - 1];
						if (fn == null) {
							throw CompilerError.create("Unexpected schedule call: " + name, pos, context);
						}
						context.append(injectValues(makeMacro(isMacro, 'schedule function ${tagPrefix}${fn} ${delay} ${mode}'), context, pos));
					case "*": // root function call
						context.append(injectValues(makeMacro(isMacro,
							'schedule function ${tagPrefix}${context.namespace}:${name.substring(1)} ${delay} ${mode}'), context, pos));
					case ".":
						if (name.charAt(1) == "/" || name.charAt(1) == "." && name.charAt(2) == "/") {
							var path = context.currentFunction.concat(name.split("/"));
							var resolved:Array<String> = [];
							for (node in path) {
								switch (node) {
									case "..":
										if (resolved.length == 0)
											throw CompilerError.create("Invalid schedule call: " + name, pos, context);
										resolved.pop();
									case "." | "":
									// ignore
									default:
										resolved.push(node);
								}
							}
							context.append(injectValues(makeMacro(isMacro,
								'schedule function ${tagPrefix}${context.namespace}:${resolved.join("/")} ${delay} ${mode}'), context, pos));
						} else {
							context.append(injectValues(makeMacro(isMacro, 'schedule function ${tagPrefix}${name} ${delay} ${mode}'), context, pos));
						}
					default:
						context.append(injectValues(makeMacro(isMacro, 'schedule function ${tagPrefix}${name} $delay $mode'), context, pos));
				}
			case ScheduleBlock(pos, delay, type, body, isMacro):
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
					Path.join(['data', context.namespace, functionsDir].concat(context.path.concat([context.compiler.config.generatedDirName, id
						+ ".mcfunction"]))),
					result);
				context.append(makeMacro(isMacro,
					'schedule function ${context.namespace}:${context.path.concat([context.compiler.config.generatedDirName, id]).join("/")} $delay $type'));
			case FunctionCall(pos, name, data, isMacro):
				name = injectValues(name, context, pos);
				// sanity check * and . calls
				// support scripting
				// testcases
				var tagPrefix = name.charAt(0) == "#" ? "#" : "";
				if (tagPrefix != "") {
					name = name.substring(1);
				}
				switch (name.charAt(0)) {
					case "^": // hiarchial function call
						var levels = Std.parseInt(name.substring(1));
						var fn = context.functions[context.functions.length - levels - 1];
						if (fn == null) {
							throw CompilerError.create("Unexpected function call: " + name, pos, context);
						}
						context.append(injectValues(makeMacro(isMacro, 'function ${tagPrefix}${fn}${data.length == 0 ? '' : ' $data'}'), context, pos));
					case "*": // root function call
						context.append(injectValues(makeMacro(isMacro,
							'function ${tagPrefix}${context.namespace}:${name.substring(1)}${data.length == 0 ? '' : ' $data'}'), context,
							pos));
					case ".":
						if (name.charAt(1) == "/" || name.charAt(1) == "." && name.charAt(2) == "/") {
							var path = context.currentFunction.concat(name.split("/"));
							var resolved:Array<String> = [];
							for (node in path) {
								switch (node) {
									case "..":
										if (resolved.length == 0)
											throw CompilerError.create("Invalid function call: " + name, pos, context);
										resolved.pop();
									case "." | "":
									// ignore
									default:
										resolved.push(node);
								}
							}
							context.append(makeMacro(isMacro,
								injectValues('function ${tagPrefix}${context.namespace}:${resolved.join("/")}${data.length == 0 ? '' : ' $data'}', context,
									pos)));
						} else {
							context.append(makeMacro(isMacro, injectValues('function ${tagPrefix}${name}${data.length == 0 ? '' : ' $data'}', context, pos)));
						}
					default:
						context.append(makeMacro(isMacro, injectValues('function ${tagPrefix}${name}${data.length == 0 ? '' : ' $data'}', context, pos)));
				}
			case Execute(pos, command, value, isMacro):
				var commands:Array<String> = [];
				var newContext = forkCompilerContextWithAppend(context, v -> {
					commands.push(v);
				}, context.functions);
				compileCommand(value, newContext);
				if (commands.length != 1) {
					throw CompilerError.create('Expected exactly 1 command after execute, got ${commands.length}', pos, context);
				}
				context.append(injectValues(makeMacro(isMacro, '$command ${commands[0]}'), context, pos));
			case ExecuteBlock(pos, execute, data, body, continuations, isMacro):
				var commands:Array<String> = [];
				var append = function(command:String) {
					commands.push(command);
				};
				var uid = Std.string(context.uidIndex.get());
				var callSignature = '${context.namespace}:${context.path.concat([context.compiler.config.generatedDirName, uid]).join("/")}';
				var newContext:CompilerContext = forkCompilerContextWithAppend(context, append, context.functions.concat([callSignature]));
				if (continuations != null) {
					context.append('scoreboard players set #ifelse ${context.compiler.config.internalScoreboardName} 0');
					newContext.append('scoreboard players set #ifelse ${context.compiler.config.internalScoreboardName} 1');
				}
				for (node in body) {
					compileCommand(node, newContext);
				}
				var result = commands.join("\n");
				saveContent(context,
					Path.join(['data', context.namespace, functionsDir].concat(context.path.concat([context.compiler.config.generatedDirName, uid
						+ ".mcfunction"]))),
					result);
				context.append(injectValues(makeMacro(isMacro, '$execute function ${callSignature}' + (data == null ? '' : ' $data')), context, pos));
				if (continuations != null) {
					// newContext.append('scoreboard players set %ifelse int 1');
					var idx = 0;
					for (continuation in continuations) {
						var isDone = idx == continuations.length - 1;
						switch (continuation) {
							case ExecuteBlock(pos, execute, data, body, _, isMacro2):
								var embedCommands:Array<String> = [
									'scoreboard players set #ifelse ${context.compiler.config.internalScoreboardName} 1'
								];
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
									Path.join(['data', context.namespace, functionsDir].concat(context.path.concat([context.compiler.config.generatedDirName, id
										+ ".mcfunction"]))),
									result);

								var executeCommandArgs = StringUtils.startsWithConstExpr(execute, "execute ") ? execute.substring(8) : execute;
								context.append(makeMacro(isMacro2,
									'execute if score #ifelse ${context.compiler.config.internalScoreboardName} matches 0 $executeCommandArgs function ${context.namespace}:${context.path.concat([context.compiler.config.generatedDirName, id]).join("/")}' +
									(data == null ? '' : ' $data')));
							case Block(_, _, body, data, isMacro2, _):
								var embedCommands:Array<String> = [
									'scoreboard players set #ifelse ${context.compiler.config.internalScoreboardName} 1'
								];
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
									Path.join(['data', context.namespace, functionsDir].concat(context.path.concat([context.compiler.config.generatedDirName, id
										+ ".mcfunction"]))),
									result);
								context.append(makeMacro(isMacro2,
									'execute if score #ifelse ${context.compiler.config.internalScoreboardName} matches 0 run function ${context.namespace}:${context.path.concat([context.compiler.config.generatedDirName, id]).join("/")}' +
									(data == null ? '' : ' $data')));

							default: throw CompilerError.create("Unexpected continuation type: " + Std.string(continuation),
									AstNodeUtils.getPos(continuation), newContext);
						}
						idx++;
					}
				}

			case CompileTimeLoop(pos, expression, as, body):
				processCompilerLoop(expression, as, context, body, pos, (context, v) -> {
					return compileCommand(v, context);
				});
			case Block(pos, name, body, data, isMacro, isInline):
				if (isInline) {
					if (data != null) {
						throw CompilerError.create("Inline block cannot have data", pos, context);
					} else {
						for (node in body) {
							compileCommand(node, context);
						}
					}
				} else {
					context.append(createAnonymousFunction(pos, body, data, context, name, isMacro));
				}
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
			context.compiler.tags.addTagEntry(appendTo, funcId, context);
		}
		saveContent(context, Path.join(['data', context.namespace, functionsDir].concat(context.path.concat([name + ".mcfunction"]))), commands.join("\n"));
	}

	private function compileDirectory(pos:PosInfo, name:String, body:Array<AstNode>, context:CompilerContext) {
		name = injectValues(name, context, pos);
		var newContext = createCompilerContext(context.namespace, v -> {
			throw CompilerError.createInternal("append not available for directory context", pos, context);
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
				saveContent(context, Path.join(['data', context.namespace, functionsDir, '$path.mcfunction']), result);
				context.compiler.tags.addTagEntry('minecraft:load', functionId, context);
			case MultiLineScript(pos, value):
				processMlScript(context, pos, value, true);
			case Comment(_, _):
			// ignore comments on the top level, they are allowed but have no output
			default:
				throw CompilerError.createInternal("unexpected node type:" + Std.string(node), AstNodeUtils.getPos(node), context);
		}
	}

	function compileJsonFile(pos:PosInfo, name:String, info:JsonTagType, context:CompilerContext) {
		switch (info) {
			case Tag(subType, replace, entries):
				if (subType == "function" || subType == "functions") {
					name = context.namespace + ":" + name;
					for (e in entries) {
						switch (e) {
							case Raw(pos, value, [], false) | Comment(pos, value):
								value = injectValues(value, context, pos);
								if (value.indexOf(" ") != -1 && StringTools.endsWith(value, " replace")) {
									context.compiler.tags.addTagEntry(name, value.substring(0, value.length - 8), context, true);
								} else if (value.indexOf(" ") != -1) {
									throw CompilerError.create("Malformed tag entry", pos, context);
								} else {
									context.compiler.tags.addTagEntry(name, value, context, false);
								}
							default:
								throw CompilerError.create("Unexpected node type in json tag", pos, context);
						}
					}
					if (replace) {
						context.compiler.tags.setTagReplace(name, true);
					}
				} else {
					var data = Json.stringify({
						replace: replace,
						values: [
							for (e in entries) {
								switch (e) {
									case Raw(pos, value, [], false) | Comment(pos, value):
										value = injectValues(value, context, pos);
										if (value.indexOf(" ") != -1 && StringTools.endsWith(value, " replace")) {
											cast {
												id: value.substring(0, value.length - 8),
												replace: true
											}
										} else if (value.indexOf(" ") != -1) {
											throw CompilerError.create("Malformed tag entry", pos, context);
										} else {
											cast value;
										}
									default:
										throw CompilerError.create("Unexpected node type in json tag", pos, context);
								}
							}
						]
					});
					var isPlural = subType.charAt(subType.length - 1) == 's';
					var writePath = if (context.compiler.config.features.useFolderRenames48) {
						isPlural ? subType.substring(0, subType.length - 1) : subType;
					} else {
						isPlural ? subType : subType + "s";
					}
					saveContent(context, Path.join(['data', context.namespace, tagsDir, writePath].concat(context.path.concat([name + ".json"]))), data);
				}
			case Advancement(entries) | ChatType(entries) | DamageType(entries) | Dimension(entries) | DimensionType(entries) | ItemModifier(entries) |
				LootTable(entries) | Predicate(entries) | Recipe(entries) | Enchantment(entries):
				var values = '{${stringifyJsonTag(pos, name, entries, context)}}';
				var type = switch (info) {
					case Advancement(_):
						context.compiler.config.features.useFolderRenames48 ? "advancement" : "advancements";
					case ChatType(_):
						"chat";
					case DamageType(_):
						"damage";
					case Dimension(_):
						"dimension";
					case DimensionType(_):
						"dimension_type";
					case ItemModifier(_):
						context.compiler.config.features.useFolderRenames48 ? "item_modifier" : "item_modifiers";
					case LootTable(_):
						context.compiler.config.features.useFolderRenames48 ? "loot_table" : "loot_tables";
					case Predicate(_):
						context.compiler.config.features.useFolderRenames48 ? "predicate" : "predicates";
					case Recipe(_):
						context.compiler.config.features.useFolderRenames48 ? "recipe" : "recipes";
					case Enchantment(_):
						"enchantment";
					case _:
						throw CompilerError.createInternal("unexpected json tag type:" + Std.string(info), pos, context);
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
				case Raw(pos, value, extra, false):
					if (extra != null && extra.length > 0) {
						throw CompilerError.create("Unexpected extra data in json tag", pos, context);
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
					throw CompilerError.createInternal("unexpected node type:" + Std.string(v), AstNodeUtils.getPos(v), context);
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
			throw CompilerError.create(Parser.format(Errors.ErrorWhilstEvaluatingExpression, e.message, pos.file, pos.line, pos.col + 1), pos, context);
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
			throw CompilerError.create(Parser.format(Errors.ErrorWhilstEvaluatingExpression, e.message, pos.file, pos.line, pos.col + 1), pos, context);
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
				throw CompilerError.create("Unexpected top-level content in template file", AstNodeUtils.getPos(ast[0]), context);
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
				Path.join(['data', context.namespace, functionsDir].concat(context.path.concat([context.compiler.config.generatedDirName, 'load.mcfunction']))),
				loadCommands.join("\n"));
			compiler.tags.addTagEntry('minecraft:load',
				context.namespace + ":" + context.path.concat([context.compiler.config.generatedDirName, 'load']).join("/"), context);
		}
		if (tickCommands.length > 0) {
			saveContent(context,
				Path.join(['data', context.namespace, functionsDir].concat(context.path.concat([context.compiler.config.generatedDirName, 'tick.mcfunction']))),
				tickCommands.join("\n"));
			compiler.tags.addTagEntry('minecraft:tick',
				context.namespace + ":" + context.path.concat([context.compiler.config.generatedDirName, 'tick']).join("/"), context);
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
	public var config:Config;
	public var disableRequire:Bool = false;

	public var templateParsingEnabled:Bool = true;

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
			throw new CompilerError("Failed to resolve import: " + resolved, false);
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

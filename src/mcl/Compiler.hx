package mcl;

import haxe.macro.Expr.Catch;
import mcl.Parser.Errors;
import js.Syntax;
import js.lib.Function;
import mcl.AstNode.JsonTagType;
import sys.FileSystem;
import haxe.macro.Context;
import haxe.crypto.Sha1;
import sys.io.File;
import mcl.Tokenizer.PosInfo;
import js.Lib;
import haxe.io.Path;

typedef Macro = {};

private class McMacro {
	private var name:String;
	private var body:Array<AstNode>;

	public function new(name:String, body:Array<AstNode>) {
		this.name = name;
		this.body = body;
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
		return new VariableMap(this, variables);
	}
}

typedef CompilerContext = {
	var append:String->Void;
	var namespace:String;
	var path:Array<String>;
	var uidIndex:Int;
	var variables:VariableMap;
};

private class McFile {
	public var name:String;

	public var existingDirectories:Map<String, Bool> = new Map();

	private var ast:Array<AstNode> = [];
	private var macros:Map<String, McMacro> = new Map();
	private var imports:Map<String, McFile> = new Map();

	public function new(name:String, ast:Array<AstNode>) {
		this.name = name;
		this.ast = ast;
	}

	public function setup() {
		var ast = this.ast;
		this.ast = [];
		for (node in ast) {
			switch (node) {
				case Import(_, importName):
					imports.set(importName, Compiler.instance.resolve(this.name, importName));
				case MacroDef(_, name, body):
					macros.set(name, new McMacro(name, body));
				default:
					this.ast.push(node);
			}
		}
	}

	private function getFunctionUid(namespace:String, name:String):String {
		var id = "";
		return '$namespace:$id';
	}

	private function createCompilerContext(namespace:String, append:String->Void, variableMap:VariableMap, path:Array<String> = null,
			uidIndex:Int = 0):CompilerContext {
		return {
			append: append,
			namespace: namespace,
			path: path == null ? [] : path,
			uidIndex: uidIndex,
			variables: variableMap
		};
	}

	private function saveContent(path:String, content:String) {
		var dir = Path.directory(path);
		if (!existingDirectories.exists(dir)) {
			FileSystem.createDirectory(dir);
			existingDirectories.set(dir, true);
		}
		File.saveContent(path, content);
	}

	private function createAnonymousFunction(pos:PosInfo, body:Array<AstNode>, data:Null<String>, context:CompilerContext):String {
		var commands:Array<String> = [];
		var newContext = createCompilerContext(context.namespace, v -> {
			commands.push(v);
		}, context.variables.fork(), context.path.concat(['zzz']), context.uidIndex);
		for (node in body) {
			compileCommandUnit(node, newContext);
		}
		var result = commands.join("\n");
		var id = Std.string(context.uidIndex++);
		saveContent(Path.join(['data', context.namespace, 'functions'].concat(context.path.concat(['zzz', id + ".mcfunction"]))), result);
		return 'function ${context.namespace}:${context.path.join("/")}/$id.mcfunction' + (data == null ? ' $data' : '');
	}

	private function compileCommandUnit(node:AstNode, context:CompilerContext):Void {
		switch (node) {
			case Raw(pos, value):
				context.append(injectValues(value, context, pos));
			case Comment(_, value):
				context.append(value);
			case AstNode.Block(pos, body, data):
				context.append(createAnonymousFunction(pos, body, data, context));
			case ExecuteBlock(pos, execute, data, body):
				var commands:Array<String> = [];
				var append = function(command:String) {
					commands.push(command);
				};
				var newContext = createCompilerContext(context.namespace, append, context.variables.fork(), context.path, context.uidIndex);
				for (node in body) {
					compileCommandUnit(node, newContext);
				}
				var result = commands.join("\n");
				var id = Std.string(context.uidIndex++);
				saveContent(Path.join(['data', context.namespace, 'functions'].concat(context.path.concat(['zzz', id + ".mcfunction"]))), result);
				context.append(injectValues('$execute function ${context.namespace}:${context.path.join("/")}/zzz/$id' + (data == null ? '' : ' $data'),
					context, pos));
			case CompileTimeLoop(pos, expression, as, body):
				processCompilerLoop(expression, as, context, body, pos, (context, v) -> {
					return compileCommandUnit(v, context);
				});
			default:
				Lib.debug();
				trace(Std.string(node));
		}
	}

	private function compileFunction(pos:PosInfo, name:String, body:Array<AstNode>, context:CompilerContext) {
		name = injectValues(name, context, pos);
		var commands:Array<String> = [];
		var append = function(command:String) {
			commands.push(command);
		};
		var context = createCompilerContext(context.namespace, append, context.variables.fork(), context.path, context.uidIndex);
		for (node in body) {
			compileCommandUnit(node, context);
		}
		saveContent(Path.join(['data', context.namespace, 'functions'].concat(context.path.concat([name + ".mcfunction"]))), commands.join("\n"));
	}

	private function compileDirectory(pos:PosInfo, name:String, body:Array<AstNode>, context:CompilerContext) {
		name = injectValues(name, context, pos);
		var newContext = createCompilerContext(context.namespace, v -> {
			throw "Internal error: append not available for directory context";
		}, context.variables.fork(), context.path.concat([name]), 0);
		for (node in body) {
			compileTld(node, newContext);
		}
	}

	private function compileTld(node:AstNode, context:CompilerContext) {
		switch (node) {
			case FunctionDef(pos, name, body):
				compileFunction(pos, name, body, context);
			case Directory(pos, name, body):
				compileDirectory(pos, name, body, context);
			case Comment(_, _):
			case JsonTag(pos, name, type, value):
				compileJsonTag(pos, name, type, value, context);
			case JsonFile(pos, name, type, value):
				compileJsonFile(pos, name, type, value, context);
			case CompileTimeLoop(pos, expression, as, body):
				processCompilerLoop(expression, as, context, body, pos, (context, v) -> {
					return compileTld(v, context);
				});
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
				var newContext = createCompilerContext(context.namespace, context.append, context.variables.fork([as => v]), context.path, context.uidIndex);
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
		}, context.variables, context.path, context.uidIndex);
		for (v in value) {
			switch (v) {
				case Raw(pos, value):
					values.push(injectValues(value, context, pos));
				case CompileTimeLoop(pos, expression, as, body):
					processCompilerLoop(expression, as, context, body, pos, (context, v) -> {
						return compileCommandUnit(v, context);
					});
				case CompileTimeIf(pos, expression, body, elseExpression):
					compileTimeIf(expression, body, elseExpression, pos, newContext);
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

	function compileTimeIf(expression:String, body:Array<AstNode>, elseExpression:Null<Array<AstNode>>, pos:PosInfo, newContext:CompilerContext,
			isContinuation:Bool = false) {
		var bool = invokeExpressionInline(expression, newContext, pos);
		if (bool) {
			for (node in body) {
				compileCommandUnit(node, newContext);
			}
		} else if (elseExpression != null) {
			for (node in elseExpression) {
				switch (node) {
					case CompileTimeIf(pos, expression, body, elseExpression):
						compileTimeIf(expression, body, elseExpression, pos, newContext, true);
					default:
						compileCommandUnit(node, newContext);
				}
			}
		}
	}

	public function compile() {
		var context = createCompilerContext(new Path(this.name).file, v -> {
			throw "Internal error: append not available for top-level context";
		}, new VariableMap(null, Globals.map), []);
		for (node in ast) {
			switch (node) {
				case Import(_, _) | MacroDef(_, _, _):
					throw "Internal error: import or macro definition found after setup";
				default:
					compileTld(node, context);
			}
		}
	}
}

class Compiler {
	public static var instance:Compiler = new Compiler();

	private var files:Map<String, McFile> = new Map();
	private var alreadySetupFiles = new Map<String, Bool>();

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
	}

	public function new() {}
}

package;

import mcl.TemplateRegisterer;
import js.Syntax;
import haxe.Timer;
import Io.MultiThreadIo;
import Io.ThreadedIo;
import mcl.Compiler;
import haxe.Serializer;
import haxe.io.Path;
import sys.FileSystem;
import mcl.Parser;
import haxe.Json;
import sys.io.File;
import mcl.Tokenizer;

class Main {
	static var debug = Sys.args().contains("--debug");
	static var debugData = new Serializer();

	static function readDirRecursive(dir:String):Array<String> {
		var files = FileSystem.readDirectory(dir);
		var result:Array<String> = [];

		for (file in files) {
			var path = Path.join([dir, file]);
			var stat = FileSystem.isDirectory(path);
			if (stat) {
				result = result.concat(readDirRecursive(path));
			} else {
				result.push(path);
			}
		}
		return result;
	}

	static function processFile(compiler:Compiler, file:String) {
		var ext = Path.extension(file);
		var content = File.getContent(file);
		var tokens = Tokenizer.tokenize(content, file);
		// trace(tokens);
		var ast = ext == "mcb" ? Parser.parseMcbFile(tokens) : Parser.parseMcbtFile(tokens);
		if (debug) {
			debugData.serialize({
				f: file,
				t: tokens,
				a: ast,
				s: content
			});

			File.saveContent(file + ".debug.json", haxe.Json.stringify({
				f: file,
				t: tokens,
				a: ast,
				s: content
			}));
		}
		// trace(Parser.parse(tokens));
		// File.saveContent(file + ".ast.json", Json.stringify(ast, null, "  "));
		compiler.addFile(file, ast);
	}

	static final threadedIo = true;

	static function main() {
		var startTime = Sys.time();
		var dir = Sys.args()[0] ?? "test-src";
		var hasMT = Sys.args().indexOf("--io-mt");
		var hasT = Sys.args().indexOf("--io-t");
		var isFile = !FileSystem.isDirectory(dir);
		var baseDir = isFile ? Path.directory(dir) : dir;
		var compiler = new Compiler(null, baseDir);
		if (hasMT >= 0)
			compiler.io = new MultiThreadIo(Std.parseInt(Sys.args()[hasMT + 1]));
		else if (hasT >= 0)
			compiler.io = new ThreadedIo();
		TemplateRegisterer.register();
		var files = !isFile ? readDirRecursive(dir).filter(f -> {
			var ext = Path.extension(f);
			ext == "mcb"
			|| ext == "mcbt";
		}) : [dir];
		for (file in files) {
			processFile(compiler, file);
		}
		var config = Syntax.code('require({0})', Path.join([Sys.getCwd(), dir, "config.js"]));
		trace(config);
		var jsRoot = new VariableMap(null, [for (k in Reflect.fields(config)) k => Reflect.field(config, k)]);
		compiler.compile(jsRoot);

		compiler.io.cleanup();
		if (debug)
			debugData.serialize(null);
		var endTime = Sys.time();
		trace("Compilation took " + (endTime - startTime) + " seconds");
		function waitForIoDone() {
			if (compiler.io.finished()) {
				trace("Finished in " + (Sys.time() - endTime) + " seconds");
				return;
			}
			Timer.delay(waitForIoDone, 100);
		}
		waitForIoDone();
		if (debug)
			File.saveContent("debug.dat", debugData.toString());
	}
}

package mcb;

import js.lib.Set;
import mcl.TemplateRegisterer;
import mcl.LibStore;
import mcl.Parser;
import mcl.Tokenizer;
import js.Syntax;
import mcl.Compiler;
import sys.FileSystem;
import haxe.io.Path;
import sys.io.File;
import mcl.AstNode;
import mcl.Tokenizer.Token;
import haxe.Unserializer;

typedef DebugFile = {
	f:String,
	t:Array<Token>,
	a:AstNode,
	s:String
}

typedef BuildOpts = {
	var watch:Bool;
	var baseDir:String;
	var libDir:String;
	var configPath:String;
}

class AppMain {
	public static function loadDebugProject(file:String, outdir:String) {
		var reader = new Unserializer(File.getContent(file));
		while (true) {
			var item:Null<DebugFile> = reader.unserialize();

			if (item == null) {
				break;
			}
			var p = Path.join([outdir, item.f]);
			FileSystem.createDirectory(Path.directory(p));
			File.saveContent(p, item.s);
			File.saveContent(p + ".tokens", Std.string(item.t));
			File.saveContent(p + ".ast", Std.string(item.a));
		}
	}

	private static function discoverConfigFile(p:String):Null<String> {
		var ext = Path.extension(p);
		if (ext == null) {
			if (FileSystem.exists(p + ".cjs")) {
				return p + ".cjs";
			} else if (FileSystem.exists(p + ".js")) {
				return p + ".js";
			} else if (FileSystem.exists(p + ".json")) {
				return p + ".json";
			} else {
				return null;
			}
		}
		return p;
	}

	public static function getFilesInDirectory(dir:String):Array<String> {
		var files = FileSystem.readDirectory(dir);
		var result = [];
		for (f in files) {
			var p = Path.join([dir, f]);
			if (FileSystem.isDirectory(p)) {
				result = result.concat(getFilesInDirectory(p));
			} else {
				result.push(p);
			}
		}
		return result;
	}

	public static function compile(opts:BuildOpts) {
		var srcDir = Path.join([opts.baseDir, 'src']);
		var compiler = new Compiler(srcDir, new LibStore(opts.libDir));
		var configPath = discoverConfigFile(opts.configPath);
		var config = Syntax.code('require({0})', configPath);
		var sourceFiles = getFilesInDirectory(srcDir);
		var observableSourceFiles:Array<String> = [];
		for (f in sourceFiles) {
			var ext = Path.extension(f);
			// if (ext != "mcb" && ext != "mcbt")
			// 	continue;
			var tokens = Tokenizer.tokenize(File.getContent(f), f);
			var ast = ext == "mcb" ? Parser.parseMcbFile(tokens) : Parser.parseMcbtFile(tokens);
			compiler.addFile(f, ast);
			observableSourceFiles.push(f);
		}
		compiler.compile(new VariableMap(null, ["config" => config]));
		var npmCacheFiles:Array<String> = untyped Object.keys(require.cache);
		return observableSourceFiles.concat(npmCacheFiles);
	}

	public static var watch:Bool = false;

	public static function doBuild(opts:BuildOpts) {
		TemplateRegisterer.register();
		watch = opts.watch;
		var files = compile(opts);
		Sys.println('Processed ${files.length} files.');
		if (opts.watch) {
			var watcher = Chokidar.watch(files, {ignoreInitial: true});
			watcher.on("change", () -> {
				untyped {
					require.cache = {};
				}
				var newFiles = compile(opts);
				var oldFileSet = new Set(files);
				var newFileSet = new Set(newFiles);
				for (file in newFiles) {
					oldFileSet.delete(file);
				}
				for (file in files) {
					newFileSet.delete(file);
				}
				if (oldFileSet.size > 0) {
					watcher.unwatch([for (f in oldFileSet) f]);
					Sys.println('Removed ${oldFileSet.size} files from the watch list.');
				}
				if (newFileSet.size > 0) {
					watcher.add([for (f in newFileSet) f]);
					Sys.println('Added ${newFileSet.size} files to the watch list.');
				}
				files = newFiles;
			});
		}
	}
}

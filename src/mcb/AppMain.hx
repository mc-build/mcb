package mcb;

import haxe.Template;
import haxe.Json;
import haxe.Http;
import Io.SyncIo;
import mcl.error.McbError;
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

@:expose
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
		if (FileSystem.exists(p + ".cjs")) {
			return p + ".cjs";
		} else if (FileSystem.exists(p + ".js")) {
			return p + ".js";
		} else if (FileSystem.exists(p + ".json")) {
			return p + ".json";
		} else {
			return p;
		}
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

	public static function create(name:String) {
		var templateDir = Path.join([Path.directory(Sys.programPath()), 'template']);
		var destDir = Path.join([Sys.getCwd(), name]);
		FileSystem.createDirectory(destDir);
		var fetcher = new Http('https://raw.githubusercontent.com/misode/mcmeta/summary/version.json');
		fetcher.onData = data -> {
			var version:{data_pack_version:Int} = Json.parse(data);
			function copyDir(from:String, to:String) {
				for (f in FileSystem.readDirectory(from)) {
					var fromPath = Path.join([from, f]);
					var toPath = Path.join([to, f]);
					if (FileSystem.isDirectory(fromPath)) {
						FileSystem.createDirectory(toPath);
						copyDir(fromPath, toPath);
					} else {
						var template = new Template(File.getContent(fromPath));
						File.saveContent(toPath, template.execute({name: name, version: version.data_pack_version}));
					}
				}
			}
			copyDir(templateDir, destDir);
		}
		fetcher.request();
	}

	private static var globalJsData = {};

	public static function compile(opts:BuildOpts) {
		Logger.log('Started build at ${Date.now().toString()}');
		var startTime = Sys.time();
		var srcDir = Path.join([opts.baseDir, 'src']);
		var configPath = discoverConfigFile(opts.configPath);
		var config = if (js.node.Fs.existsSync(configPath)) try {
			Syntax.code('require({0})', configPath);
		} catch (e) {
			Logger.error('Failed to load config file: ${configPath}');
			throw e;
		} else {
			Logger.warn('Config file not found, using default config.');
			cast {};
		};
		var compiler = new Compiler(srcDir, config, new LibStore(opts.libDir));
		var didFail = true;
		try {
			compiler.config.events.onPreBuild.dispatch({});
			var sourceFiles = getFilesInDirectory(srcDir);
			for (f in sourceFiles) {
				var ext = Path.extension(f);
				if (ext != "mcb" && ext != "mcbt")
					continue;
				var tokens = Tokenizer.tokenize(File.getContent(f), f);
				try {
					var ast = ext == "mcb" ? Parser.parseMcbFile(tokens) : Parser.parseMcbtFile(tokens);
					compiler.addFile(f, ast);
				} catch (e:Dynamic) {
					compiler.success = false;
					throw e;
				}
			}

			compiler.compile(new VariableMap(null, ["config" => config, "global" => globalJsData, "store" => {}]));
			didFail = false;
		} catch (e:Dynamic) {
			didFail = true;
			if (McbError.isMclError(e)) {
				var x:McbError = cast e;
				Logger.error(x.message);
			} else {
				Logger.error('A fatal error occurred during compilation. Please report this to the developers.');
				throw e;
			}
		}
		compiler.config.events.onPostBuild.dispatch({
			success: !didFail
		});
		var endTime = Sys.time();
		Logger.log('Build finished in ${untyped (endTime - startTime).toFixed(2)} seconds');
		// var npmCacheFiles:Array<String> = untyped Object.keys(require.cache);
		return compiler; // .concat(npmCacheFiles);
	}

	public static var watch:Bool = false;
	#if !lib
	static var chars = Figures.default_;
	#end

	public static function doBuild(opts:BuildOpts) {
		TemplateRegisterer.register();
		watch = opts.watch;
		var cacheFile = Path.join([opts.baseDir, '.mcb', 'fs-cache.txt']);
		var cache = FileSystem.exists(cacheFile) ? [
			for (e in File.getContent(cacheFile).split("\n").map(line -> line.split(":")))
				if (e[0] != "") e[0] => e[1]
		] : new Map<String, String>();
		function writeCache() {
			FileSystem.createDirectory(Path.directory(cacheFile));
			File.saveContent(cacheFile, [
				for (k => v in cache)
					'$k:$v'
			].join("\n"));
		}
		function handleUpdatingFilesBasedOnCache(io:Io) {
			var added = io.reportFilesAdded(cache);
			var removed = io.reportFilesRemoved(cache);
			var changed = io.reportFilesChanged(cache);
			var dirsToCheck = new Set<String>();
			for (f in removed) {
				if (FileSystem.exists(f))
					FileSystem.deleteFile(f);
				dirsToCheck.add(Path.directory(f));
			}
			var dirList = [for (k in dirsToCheck) k];
			var deletedDirs = new Set<String>();
			for (dir in dirList) {
				if (dir != '' && !deletedDirs.has(dir) && FileSystem.readDirectory(dir).length == 0) {
					FileSystem.deleteDirectory(dir);
					dirList.push(Path.join([dir, '..']));
					deletedDirs.add(dir);
				}
			}
			#if !lib
			Logger.log('${chars.arrowUp} Added: ${added.length}');
			Logger.log('${chars.arrowDown} Removed: ${removed.length}');
			Logger.log('${chars.arrowRight} Changed: ${changed.length}');
			#end
			cache = io.reportFileMetadata();
			writeCache();
		}
		var build = compile(opts);
		if (build.success)
			handleUpdatingFilesBasedOnCache(build.io);
		else {
			if (Syntax.instanceof(build.io, SyncIo)) {
				var x:SyncIo = cast build.io;
				Logger.warn("Reverting file changes...");
				x.revertMap.revert();
			}
		}
		#if !lib
		if (opts.watch) {
			Logger.log('Watch mode enabled, Watching for changes...');
			var watcher = Chokidar.watch(["src/**"], {ignoreInitial: true});
			function handleFsEvent() {
				Logger.log('File change detected, recompiling...');
				var compiler = compile(opts);
				if (compiler.success)
					handleUpdatingFilesBasedOnCache(compiler.io);
				else if (Syntax.instanceof(compiler.io, SyncIo)) {
					var x:SyncIo = cast compiler.io;
					Logger.warn("Reverting file changes...");
					x.revertMap.revert();
				}
				Logger.log('Watching for changes...');
			}
			watcher.on("change", handleFsEvent);
			watcher.on("add", handleFsEvent);
			watcher.on("unlink", handleFsEvent);
		}
		#end
	}
}

package;

import mcl.LibStore;
import mcl.Config.UserConfig;
import mcl.TemplateRegisterer;
import mcl.args.TemplateArgument;
import mcl.AstNode;
import sys.io.File;
import mcl.Tokenizer;
import haxe.io.Path;
import mcl.Parser;
import mcl.Compiler;
import Io.MultiThreadIo;
import Io.ThreadedIo;
import Io.SyncIo;

typedef CompileOptions = {};

@:keep
@:keepSub
@:expose("mcb")
class LibMain {
	public static function main() {
		TemplateRegisterer.register();
	}

	public static function createCompiler(baseDir:String, config:UserConfig, ?libStore:LibStore) {
		return new Compiler(baseDir, config, libStore);
	}

	public static function parseFile(path:String, content:String):Array<AstNode> {
		var ext = Path.extension(path);
		var tokens = Tokenizer.tokenize(content, path);
		if (ext == "mcb")
			return Parser.parseMcbFile(tokens);
		else if (ext == "mcbt")
			return Parser.parseMcbtFile(tokens);
		else
			throw "Unknown file extension: " + ext;
	}

	public static function addFileToCompiler(compiler:Compiler, path:String) {
		final ext = Path.extension(path);
		var tokens = Tokenizer.tokenize(File.getContent(path), path);
		compiler.addFile(path, ext == "mcb" ? Parser.parseMcbFile(tokens) : Parser.parseMcbtFile(tokens));
	}

	public static function compileFromFsLikeMap(baseDir:String, files:js.lib.Map<String, String>, io:Io):Void {
		var compiler = createCompiler(baseDir, cast {}, null);
		for (path in files.keyValueIterator()) {
			var tokens = Tokenizer.tokenize(path.value, path.key);
			compiler.addFile(path.key, Path.extension(path.key) == "mcb" ? Parser.parseMcbFile(tokens) : Parser.parseMcbtFile(tokens));
		}
		compiler.io = io;
		compiler.compile(new VariableMap(null));
	}

	public static function createIoProvider(threadCount:Int):Io {
		switch (threadCount) {
			case 0:
				return new SyncIo();
			case 1:
				return new ThreadedIo();
			default:
				return new MultiThreadIo(threadCount);
		}
	}
}

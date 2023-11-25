package;

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
	public static function createCompiler(baseDir:String) {
		return new Compiler(null, baseDir);
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

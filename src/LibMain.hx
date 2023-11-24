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

enum IoType {
	Sync;
	Thread;
	ThreadPool(size:Int);
}

@:keep
@:keepSub
@:expose("mcb")
class LibMain {
	public static function createCompiler(baseDir:String) {
		return new Compiler(null, baseDir);
	}

	public static function setIoProvider(provider:Io) {
		Compiler.io = provider;
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

	public static final IoType = IoType;

	public static function createIoProvider(type:IoType):Io {
		switch (type) {
			case Sync:
				return new SyncIo();
			case Thread:
				return new ThreadedIo();
			case ThreadPool(size):
				return new MultiThreadIo(size);
		}
	}
}

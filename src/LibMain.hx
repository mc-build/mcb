package;

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
	public static function createCompiler() {
		return new Compiler();
	}

	public static function setIoProvider(provider:Io) {
		Compiler.io = provider;
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

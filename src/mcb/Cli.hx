package mcb;

import sys.FileSystem;
import haxe.io.Path;
import mcl.AstNode;
import mcl.Tokenizer.Token;
import sys.io.File;
import haxe.Unserializer;

typedef DebugFile = {
	f:String,
	t:Array<Token>,
	a:AstNode,
	s:String
}

class Cli {
	public static function loadDebugProject(file:String, outdir:String) {
		var reader = new Unserializer(File.getContent(file));

		var files = [];

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

		trace(files);

		var x = AstNode.Comment({
			file: "test",
			line: 1,
			col: 1
		}, "");
	}

	public static function main() {
		var args = Sys.args();
		if (args[0] == "debug") {
			var file = args[1];
			var outdir = args[2];
			Cli.loadDebugProject(file, outdir);
		}
	}
}

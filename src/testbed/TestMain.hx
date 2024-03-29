package testbed;

import js.Syntax;
import mcl.TemplateRegisterer;
import sys.io.File;
import mcl.Parser;
import mcl.Tokenizer;
import haxe.io.Path;
import mcl.Compiler;

class TestMain {
	public static function main() {
		TemplateRegisterer.register();
		var tests = TestBuilder.getTests();
		for (t in tests) {
			trace("Running test: " + t.name);
			var io = new TestIo();
			var compiler = new Compiler("", cast {
				internalScoreboardName: "_internal_scoreboard"
			});
			compiler.io = io;
			for (f in t.sources) {
				var ext = Path.extension(f.path);
				var tokens = Tokenizer.tokenize(f.content, f.path);
				var ast = ext == "mcb" ? Parser.parseMcbFile(tokens) : Parser.parseMcbtFile(tokens);
				compiler.addFile(f.path, ast);
			}

			var jsRoot = if (t.configPath != null) {
				var config = Syntax.code('require({0})', t.configPath);
				new VariableMap(null, [for (k in Reflect.fields(config)) k => Reflect.field(config, k)]);
			} else new VariableMap(null);
			compiler.compile(jsRoot);

			var res = io.print();
			if (t.expectedResult == null || Sys.args().contains("--write")) {
				File.saveContent(t.resultPath, res);
				Sys.println("SAVED - " + t.name);
			} else {
				if (t.expectedResult == res) {
					Sys.println("PASS - " + t.name);
				} else {
					Sys.println("FAIL - " + t.name);
				}
			}
		}
	}
}

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
			var io = new TestIo();
			Compiler.instance = new Compiler('mcb-test-${t.name}', "");
			Compiler.io = io;
			for (f in t.sources) {
				var ext = Path.extension(f.path);
				var tokens = Tokenizer.tokenize(f.content, f.path);
				var ast = ext == "mcb" ? Parser.parseMcbFile(tokens) : Parser.parseMcbtFile(tokens);
				Compiler.instance.addFile(f.path, ast);
			}

			var jsRoot = if (t.configPath != null) {
				var config = Syntax.code('require({0})', t.configPath);
				new VariableMap(null, [for (k in Reflect.fields(config)) k => Reflect.field(config, k)]);
			} else new VariableMap(null);
			Compiler.instance.compile(jsRoot);

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

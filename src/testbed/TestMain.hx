package testbed;

import sys.FileSystem;
import haxe.macro.Expr.Catch;
import mcl.FeatureFlags;
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
		var versionMatrix = [0];
		for (k => _ in FeatureFlags.flags) {
			versionMatrix.push(k);
		}
		versionMatrix.push(99999);
		var tests = TestBuilder.getTests();
		for (t in tests) {
			trace("Running test: " + t.name);
			for (i in versionMatrix) {
				try {
					var io = new TestIo();
					var compiler = new Compiler("", cast {
						internalScoreboardName: "_internal_scoreboard",
						formatVersion: i,
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
					if (t.expectedResult.get(i) == null || Sys.args().contains("--write")) {
						FileSystem.createDirectory(t.resultPath);
						File.saveContent(t.resultPath + '/${i}.txt', res);
						Sys.println('(${i}) WROTE - ' + t.name);
					} else {
						if (t.expectedResult.get(i) == res) {
							Sys.println('(${i}) PASS - ' + t.name);
						} else {
							Sys.println('(${i}) FAIL - ' + t.name);
						}
					}
				} catch (e) {
					FileSystem.createDirectory(t.resultPath);
					Sys.println('(${i}) ERROR - ' + t.name);
					Sys.println(e);
					File.saveContent(t.resultPath + '/${i}.txt', Std.string(e));
				}
			}
		}
	}
}

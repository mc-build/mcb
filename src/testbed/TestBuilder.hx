package testbed;

import mcl.FeatureFlags;
import sys.io.File;
import haxe.io.Path;
import sys.FileSystem;

class TestBuilder {
	public static macro function getTests() {
		var cwd = Sys.getCwd();
		var dirs = FileSystem.readDirectory(Path.join([Sys.getCwd(), 'tests']));
		var versions = [0];
		for (k => v in FeatureFlags.flags) {
			versions.push(k);
		}
		versions.push(99999);
		var tests:Array<Test> = [
			for (dir in dirs) {
				var dirPath = Path.join([cwd, 'tests', dir]);
				var resultFilePath = Path.join([dirPath, 'result']);
				var sourceDirPath = Path.join([dirPath, 'source']);
				var configPath:Null<String> = null;
				if (FileSystem.exists(Path.join([dirPath, 'env.js']))) {
					configPath = Path.join([dirPath, 'env.js']);
				}
				var test:Test = {
					name: dir,
					sources: [
						for (entry in FileSystem.readDirectory(sourceDirPath))
							({
								path:entry, content:File.getContent(Path.join([sourceDirPath, entry]))
							})
					],
					// expectedResult: FileSystem.exists(resultFilePath) ? File.getContent(resultFilePath) : null,
					expectedResult: [
						for (v in versions)
							v => FileSystem.exists(resultFilePath + '/' + v + ".txt") ? File.getContent(resultFilePath + '/' + v + ".txt") : null
					],
					resultPath: resultFilePath,
					configPath: configPath
				}
				test;
			}
		];
		return macro $v{tests};
	}
}

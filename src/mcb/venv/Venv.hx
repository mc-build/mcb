package mcb.venv;

import js.Node;
import js.Lib;
import js.Syntax;
import js.node.ChildProcess;
import sys.io.Process;
import sys.io.File;
import haxe.Json;
import haxe.io.Path;
import sys.FileSystem;
import mcli.CommandLine;

class Venv extends CommandLine {
	static public function create(name:String) {
		trace("create " + name);
		var dir = Path.directory(Sys.programPath());
		var venvVersionDir = Path.join([dir, ".venv", "versions"]);
		FileSystem.createDirectory(venvVersionDir);
		var tempFile = Path.join([venvVersionDir, ".npmres" + Math.random()]);
		trace("Working...");
		var out = Std.string(ChildProcess.execSync("npm view mc-build versions --json"));
		var versions:Array<String> = Json.parse(out);

		Sys.command('npm view mc-build versions --json > $tempFile');
		FileSystem.deleteFile(tempFile);
		var shell = Sys.getEnv("SHELL");
		trace("Shell: " + shell);
		if (versions.contains(name)) {
			var versionDir = Path.join([venvVersionDir, name]);
			if (!FileSystem.exists(versionDir)) {
				trace("Installing...");
				FileSystem.createDirectory(versionDir);
				ChildProcess.execSync('npm init -y', {cwd: versionDir});
				// Sys.command('npm install mc-build@' + name);
				ChildProcess.execSync('npm install mc-build@' + name, {cwd: versionDir});
			}
			var path = Path.join([versionDir, "node_modules", ".bin"]);
			var env = Syntax.code("{...process.env,PATH:{0},MCBVENVVERSION:{1}}", path, name);
			var winScriptPath = Path.join([Path.directory(Sys.programPath()), ".venv", "scripts", "windows.ps1"]);
			// untyped {
			// 	process.stdin.resume();
			// }
			var mcbVenvScript = Ps1Builder.build("mcb-venv", winScriptPath, ["MCBPATH" => path, "MCBVERSION" => name]);
			FileSystem.createDirectory(Path.join([Sys.getCwd(), "venv"]));
			File.saveContent(Path.join([Sys.getCwd(), "venv", "mcb-venv.ps1"]), mcbVenvScript);
		} else {
			trace("Version not found.");
			trace("Available versions: " + versions.join(", "));
		}
	}

	static public function activate() {}
}

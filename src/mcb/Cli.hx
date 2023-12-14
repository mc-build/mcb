package mcb;

import node.fs.WatchOptions;
import sys.FileSystem;
import haxe.io.Path;
import mcl.AstNode;
import mcl.Tokenizer.Token;
import sys.io.File;
import haxe.Unserializer;
import mcli.CommandLine;
import Chokidar;

class Cli extends CommandLine {
	public var libPath:String = Path.join([Path.directory(Sys.programPath()), "./.mcblib"]);
	public var baseDir:String = Sys.getCwd();
	public var configPath:String = Path.join([this.baseDir, "./config"]);

	// 	2+ = thread pool (must be a power of 2)
	// 	0 = synchronous (default)\n
	// 	1 = threaded\n
	public var ioThreadCount:Int = 0;

	@:skip private var didRun:Bool = false;

	public function build() {
		didRun = true;
		mcb.AppMain.doBuild({
			watch: false,
			libDir: this.libPath,
			baseDir: this.baseDir,
			configPath: this.configPath,
		});
	}

	public function help() {
		Sys.println("MCB - A Minecraft Data Pack build tool.");
		Sys.println("");
		Sys.println("Usage:");
		Sys.println("mcb build");
		Sys.println("mcb watch");
		Sys.println("");
		Sys.println("Flags:");
		Sys.println(this.showUsage());
		Sys.exit(0);
	}

	public function runDefault(?mode:String) {
		if (didRun)
			return;
		switch (mode) {
			case "build":
				this.build();
			case "watch":
				this.watch();
			default:
				this.help();
		}
	}

	@:alias("watch") public function watch() {
		didRun = true;
		AppMain.doBuild({
			watch: true,
			libDir: this.libPath,
			baseDir: this.baseDir,
			configPath: this.configPath,
		});
	}

	public static function main() {
		new mcli.Dispatch(Sys.args()).dispatch(new Cli());
	}

	@:alias("create") public function init(name:String) {
		didRun = true;
	}
}

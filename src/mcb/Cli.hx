package mcb;

import mcb.venv.Venv;
import haxe.io.Path;
import mcli.CommandLine;

class Cli extends CommandLine {
	public var libPath:String = Path.join([Path.directory(Sys.programPath()), "./.mcblib"]);
	public var baseDir:String = Sys.getCwd();
	public var configPath:String = Path.join([this.baseDir, "./mcb.config"]);

	// 	2+ = thread pool (must be a power of 2)
	// 	0 = synchronous (default)\n
	// 	1 = threaded\n
	public var ioThreadCount:Int = 0;

	@:skip private var didRun:Bool = false;

	public function create(packName:String) {
		didRun = true;
		mcb.AppMain.create(packName);
	}

	public function build() {
		didRun = true;
		mcb.AppMain.doBuild({
			watch: false,
			libDir: this.libPath,
			baseDir: this.baseDir,
			configPath: this.configPath,
		});
	}

	public function generate(outfile:String) {
		didRun = true;
		mcb.AppMain.generate(outfile, {
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
		Sys.println("mcb create <pack-name>");
		Sys.println("mcb venv setup <name>");
		Sys.println("mcb venv activate");
		Sys.println("mcb generate");
		Sys.println("");
		Sys.println("Flags:");
		Sys.println(this.showUsage());
		Sys.exit(0);
	}

	public function runDefault(?mode:String, ?venvAction:String, ?venvName:String) {
		if (didRun)
			return;
		switch (mode) {
			case "build":
				this.build();
			case "watch":
				this.watch();
			case "venv":
				switch (venvAction) {
					case "setup":
						Venv.create(venvName);
					case "activate":
						Venv.activate();
				}
			case "generate":
				this.generate(venvAction);
			case "create":
				this.create(venvAction);
			default:
				this.help();
		}
	}

	@:alias("venv") public function venv(?action:String, ?name:String) {
		didRun = true;
		switch (action) {
			case "setup":
				Venv.create(name);
			case "activate":
				Venv.activate();
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

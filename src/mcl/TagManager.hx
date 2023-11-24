package mcl;

import haxe.Json;
import haxe.io.Path;
import js.lib.Set;

class TagManager {
	var tickFunctionEntries:Set<String> = new Set<String>();
	var loadFunctionEntries:Set<String> = new Set<String>();

	public function new() {}

	public function addTickingCommand(command:String) {
		tickFunctionEntries.add(command);
	}

	public function addLoadingCommand(command:String) {
		loadFunctionEntries.add(command);
	}

	public function writeTagFiles(compiler:Compiler) {
		var basePath = Path.join(['data', 'minecraft', 'tags', 'functions']);
		var tickPath = Path.join([basePath, 'tick.json']);
		var loadPath = Path.join([basePath, 'load.json']);
		if (tickFunctionEntries.size > 0)
			compiler.io.write(tickPath, Json.stringify({values: [for (k in tickFunctionEntries) k]}));

		if (loadFunctionEntries.size > 0)
			compiler.io.write(loadPath, Json.stringify({values: [for (k in loadFunctionEntries) k]}));
	}
}

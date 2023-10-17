package mcl;

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

	public function writeTagFiles() {}
}

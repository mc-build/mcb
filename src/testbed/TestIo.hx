package testbed;

import js.Lib;

class TestIo implements Io {
	var files:Map<String, String> = new Map();

	public function new() {}

	public function write(path:String, content:String) {
		if (files.exists(path)) {
			Lib.debug();
			trace("Warning: overwriting file " + path);
		}
		files.set(path, content);
	}

	public function cleanup() {}

	public function finished():Bool {
		return true;
	}

	public function print():String {
		var result = "";
		for (k => v in files) {
			result += k + ":\n" + v + "\n----------------\n";
		}
		return result;
	}

	public function reportFilesRemoved(oldFiles:Map<String, String>):Array<String> {
		return [];
	}

	public function reportFilesAdded(oldFiles:Map<String, String>):Array<String> {
		return [];
	}

	public function reportFilesChanged(oldFiles:Map<String, String>):Array<String> {
		return [];
	}

	public function reportFileMetadata():Map<String, String> {
		return [];
	}
}

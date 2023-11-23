package testbed;

class TestIo implements Io {
	var files:Map<String, String> = new Map();

	public function new() {}

	public function write(path:String, content:String) {
		if (files.exists(path))
			trace("Warning: overwriting file " + path);
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
}

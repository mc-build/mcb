package mcb;

import mcl.Parser;

class Logger {
	public static var enabled = true;

	public static function time(message:String) {
		if (!enabled) {
			return () -> {};
		}
		var start = Sys.time();
		return function() {
			var end = Sys.time();
			log(Parser.format(message, '${end - start}'));
		};
	}

	public static function log(msg:Any) {
		if (enabled) {
			trace(msg);
		}
	}

	public static function error(msg) {
		if (enabled) {
			trace("ERROR: " + msg);
		}
	}

	public static function warn(msg) {
		if (enabled) {
			trace("WARN: " + msg);
		}
	}
}

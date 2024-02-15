package mcb;

import mcl.Parser;

class Logger {
	public static var enabled = true;
	public static var chalk = Chalk.default_;

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
			// Sys.println('${chalk.lightGray("[")}${chalk.green(Sys.time())}${chalk.gray("]")} ${msg}');
			Sys.println(chalk.gray.call("[") + chalk.green.call("MCB") + chalk.gray.call("] ") + chalk.white.call(msg));
		}
	}

	public static function error(msg) {
		if (enabled) {
			Sys.println(chalk.gray.call("[") + chalk.green.call("MCB") + chalk.gray.call("] ") + chalk.redBright.call(msg));
		}
	}

	public static function warn(msg) {
		if (enabled) {
			Sys.println(chalk.gray.call("[") + chalk.green.call("MCB") + chalk.gray.call("] ") + chalk.yellow.call(msg));
		}
	}
}

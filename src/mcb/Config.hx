package mcb;

import haxe.io.Path;

class Config {
	public static var debug:Bool = false;
	public static var libDir:String = Path.join([Sys.programPath(), '..', '.mcblib']);
}

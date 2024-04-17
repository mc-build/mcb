package mcl.error;

import haxe.Exception;
import js.Syntax;

class McbError extends Exception {
	public function new(msg:String) {
		super(msg);
	}

	public static function isMclError(e:Any):Bool {
		return Syntax.instanceof(e, McbError);
	}

	@:keep
	private function __init__() {}
}

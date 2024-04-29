package mcl.error;

import mcl.Tokenizer.PosInfo;
import haxe.Exception;
import js.Syntax;

class McbError extends Exception {
	@:keep
	var mcbstack:Array<PosInfo>;

	public function new(msg:String, stack:Array<PosInfo>) {
		super(msg);
		this.mcbstack = stack;
	}

	public static function isMclError(e:Any):Bool {
		return Syntax.instanceof(e, McbError);
	}

	@:keep
	private function __init__() {}
}

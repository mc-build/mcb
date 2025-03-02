package mcl.error;

import mcl.Tokenizer.PosInfo;
import haxe.Exception;
import js.Syntax;

class McbError {
	@:keep
	var mcbstack:Array<PosInfo>;
	@:keep
	public var message:String;

	public function new(msg:String, stack:Array<PosInfo>) {
		this.mcbstack = stack;
		this.message = msg;
	}

	public static function isMclError(e:Any):Bool {
		return Syntax.instanceof(e, McbError);
	}

	@:keep
	private function __init__() {}
}

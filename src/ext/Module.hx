package ext;

@:jsRequire("module")
extern class Module {
	public extern static function createRequire(file:String):String->Any;
}

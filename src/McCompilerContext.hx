import MinificationHelper.Minified;

class McCompilerContext {
	public static var current(get, default):McCompilerContext;
	private static var stack:Array<McCompilerContext> = [];

	public static function get_current()
		return McCompilerContext.stack[McCompilerContext.stack.length - 1];

	public function new() {
		McCompilerContext.stack.push(this);
	}

	public function dispose() {
		McCompilerContext.stack.pop();
	}
}

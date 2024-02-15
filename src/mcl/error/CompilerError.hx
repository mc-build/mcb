package mcl.error;

class CompilerError extends McbError {
	var internal:Bool;

	public function new(message:String, ?internal:Bool = false) {
		super('${internal ? 'Internal ' : ''}Compiler Error:\n\t$message');
		this.internal = internal;
	}
}

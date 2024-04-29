package mcl.error;

import mcl.Tokenizer.PosInfo;
import mcl.Compiler.ErrorUtil;
import mcl.Compiler.CompilerContext;

class CompilerError extends McbError {
	var internal:Bool;

	public function new(message:String, internal:Bool, mcbstack:Null<Array<PosInfo>> = null) {
		super('${internal ? 'Internal ' : ''}Compiler Error:\n\t$message', mcbstack);
		this.internal = internal;
	}

	static public inline function createInternal(message:String, pos:PosInfo, context:CompilerContext) {
		return new CompilerError(ErrorUtil.formatContext(message, pos, context), true, [pos].concat(context.stack));
	}

	static public inline function create(message:String, pos:PosInfo, context:CompilerContext) {
		return new CompilerError(ErrorUtil.formatContext(message, pos, context), false, [pos].concat(context.stack));
	}
}

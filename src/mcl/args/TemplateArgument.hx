package mcl.args;

import mcl.Compiler.McFile;
import mcl.Compiler.CompilerContext;
import mcl.Tokenizer.PosInfo;

typedef TemplateParseResult = {success:Bool, ?value:Dynamic, ?raw:String};

class TemplateArgument {
	public var name:String;
	public var pos:PosInfo;
	public var expectBlock:Bool = false;

	public static var argumentTypes = new Map<String, Class<TemplateArgument>>();

	function new(s:String, pos:PosInfo) {
		this.name = s;
		this.pos = pos;
	}

	public static function parse(s:String, p:PosInfo) {
		var colon = s.indexOf(":");
		var type = colon == -1 ? 'raw' : s.substring(colon + 1);
		var name = colon == -1 ? s : s.substring(0, colon);
		if (!argumentTypes.exists(type))
			throw "Unknown template argument type: '" + type + "'";
		return Type.createInstance(argumentTypes.get(type), [name]);
	}

	public function parseValue(s:String, p:PosInfo, context:CompilerContext):TemplateParseResult {
		throw "override this method in subclass, plz thx";
	}

	public function parseValueBlock(s:AstNode, p:PosInfo, context:CompilerContext):TemplateParseResult {
		throw "override this method in subclass, plz thx";
	}

	public static function register(type:String, c:Class<TemplateArgument>) {
		if (argumentTypes.exists(type))
			throw "Template argument type already registered: " + type;
		argumentTypes.set(type, c);
	}
}

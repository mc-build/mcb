package mcl.args;

import mcl.Compiler.McFile;
import mcl.Compiler.CompilerContext;
import mcl.args.TemplateArgument.TemplateParseResult;
import mcl.Tokenizer.PosInfo;

class BoundBlock {
	var node:AstNode;
	var ctx:CompilerContext;

	public function new(node:AstNode, ctx:CompilerContext) {
		this.node = node;
		this.ctx = ctx;
	}

	@:keep
	public function embedTo(context:CompilerContext, pos:PosInfo, file:McFile):String {
		var content:Array<String> = [];
		var ctx:CompilerContext = {
			isTemplate: false,
			uidIndex: context.uidIndex,
			namespace: context.namespace,
			path: context.path,
			variables: this.ctx.variables,
			replacements: this.ctx.replacements,
			stack: this.ctx.stack,
			append: (s:String) -> content.push(s),
			templates: this.ctx.templates
		};
		file.embed(ctx, pos, new Map(), [this.node]);
		return content.join("\n");
	}
}

class BlockTemplateArgument extends TemplateArgument {
	public static function register() {
		TemplateArgument.register("block", BlockTemplateArgument);
	}

	public function new(s:String, pos:PosInfo) {
		super(s, pos);
		expectBlock = true;
	}

	public override function parseValueBlock(s:AstNode, p:PosInfo, context:CompilerContext):TemplateParseResult {
		switch (s) {
			case Block(_, _, _, _):
				return {success: true, value: new BoundBlock(s, context)};
			default:
				return {success: false};
		}
	}
}

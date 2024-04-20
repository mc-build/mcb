package mcl.args;

import mcl.Parser.TokenInput;
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
	public function appendAstNode(node:AstNode):Void {
		switch (this.node) {
			case Block(_, _, body, _, _):
				body.push(node);
			default:
				throw "BoundBlock.append: node is not a block";
		}
	}

	@:keep public function append(code:String):Void {
		var tokens = Tokenizer.tokenize(code, '<inline BoundBlock.append>');
		var tokenInput = new TokenInput(tokens);
		while (tokenInput.hasNext()) {
			this.appendAstNode(Parser.innerParse(tokenInput));
		}
	}

	@:keep
	public function setName(name:String):Void {
		switch (this.node) {
			case Block(pos, _, body, data, isMacro, isInline):
				this.node = Block(pos, name, body, data, isMacro, isInline);
			default:
				throw "BoundBlock.setName: node is not a block";
		}
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
			templates: this.ctx.templates,
			requireTemplateKeyword: this.ctx.requireTemplateKeyword,
			compiler: this.ctx.compiler,
			globalVariables: this.ctx.globalVariables,
			functions: this.ctx.functions,
			baseNamespaceInfo: context.baseNamespaceInfo,
			currentFunction: this.ctx.currentFunction
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

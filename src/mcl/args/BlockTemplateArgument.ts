import type { CompilerContext, McFile } from "../Compiler";
import type { AstNode } from "../AstNode";
import { Parser } from "../Parser";
import { Tokenizer } from "../TokenizerImpl";
import { PosInfo } from "../Tokenizer";
import { TemplateArgument, TemplateParseResult } from "./TemplateArgument";

export class BoundBlock {
  constructor(private node: AstNode, private context: CompilerContext) {}

  appendAstNode(node: AstNode): void {
    if (this.node.type !== "Block") {
      throw new Error("BoundBlock.append: node is not a block");
    }
    this.node.body.push(node);
  }

  append(code: string): void {
    const tokens = Tokenizer.tokenize(code, "<inline BoundBlock.append>");
    const astNodes = Parser.parseInline(tokens);
    for (const node of astNodes) {
      this.appendAstNode(node);
    }
  }

  setName(name: string): void {
    if (this.node.type !== "Block") {
      throw new Error("BoundBlock.setName: node is not a block");
    }
    this.node = { ...this.node, name };
  }

  embedTo(context: CompilerContext, pos: PosInfo, file: McFile, actuallyEmbed = true): string {
    const content: string[] = [];
    const newContext: CompilerContext = {
      append: (value: string) => {
        content.push(value);
      },
      namespace: context.namespace,
      path: context.path,
      uidIndex: context.uidIndex,
      variables: this.context.variables,
      replacements: this.context.replacements,
      stack: this.context.stack,
      isTemplate: false,
      templates: this.context.templates,
      requireTemplateKeyword: this.context.requireTemplateKeyword,
      compiler: this.context.compiler,
      globalVariables: this.context.globalVariables,
      functions: this.context.functions,
      baseNamespaceInfo: context.baseNamespaceInfo,
      currentFunction: this.context.currentFunction,
    };
    if (actuallyEmbed) {
      file.embed(newContext, pos, new Map(), [this.node]);
    } else {
      file.embedTransform(newContext, pos, new Map(), [this.node]);
    }
    return content.join("\n");
  }
}

export class BlockTemplateArgument extends TemplateArgument {
  static register(): void {
    TemplateArgument.register("block", BlockTemplateArgument);
  }

  constructor(name: string | null, pos: PosInfo) {
    super(name, pos);
    this.expectBlock = true;
  }

  parseValueBlock(node: AstNode, _pos: PosInfo, context: CompilerContext): TemplateParseResult {
    if (node.type !== "Block") {
      return { success: false };
    }
    return { success: true, value: new BoundBlock(node, context) };
  }

  parseValue(_value: string, _pos: PosInfo, _context: CompilerContext): TemplateParseResult {
    return { success: false };
  }
}

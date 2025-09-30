import type { CompilerContext } from "../Compiler";
import { PosInfo } from "../Tokenizer";
import { TemplateArgument, TemplateParseResult } from "./TemplateArgument";

export class LiteralTemplateArgument extends TemplateArgument {
  private readonly literal: string;

  constructor(name: string | null, pos: PosInfo) {
    super(null, pos);
    this.literal = name ?? "";
  }

  static register(): void {
    TemplateArgument.register("literal", LiteralTemplateArgument);
  }

  parseValue(value: string, _pos: PosInfo, _context: CompilerContext): TemplateParseResult {
    if (value === this.literal || value.startsWith(`${this.literal} `)) {
      return { success: true, value, raw: this.literal };
    }
    return { success: false };
  }
}

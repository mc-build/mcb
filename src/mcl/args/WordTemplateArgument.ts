import type { CompilerContext } from "../Compiler";
import { PosInfo } from "../Tokenizer";
import { TemplateArgument, TemplateParseResult } from "./TemplateArgument";

export class WordTemplateArgument extends TemplateArgument {
  static register(): void {
    TemplateArgument.register("word", WordTemplateArgument);
  }

  constructor(name: string | null, pos: PosInfo) {
    super(name, pos);
  }

  parseValue(value: string, _pos: PosInfo, _context: CompilerContext): TemplateParseResult {
    if (!value) {
      return { success: false };
    }
    const spaceIdx = value.indexOf(" ");
    const word = spaceIdx === -1 ? value : value.substring(0, spaceIdx);
    return { success: true, value: word, raw: word };
  }
}

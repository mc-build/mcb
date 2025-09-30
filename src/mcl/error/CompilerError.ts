import { PosInfo } from "../Tokenizer";
import { McbError } from "./McbError";

export interface CompilerContextLike {
  stack: (PosInfo | null)[];
}

export class CompilerError extends McbError {
  readonly internal: boolean;

  constructor(message: string, internal: boolean, stack: PosInfo[]) {
    super(`${internal ? "Internal " : ""}Compiler Error:\n\t${message}`, stack);
    this.internal = internal;
  }

  static createInternal(message: string, pos: PosInfo | null, context: CompilerContextLike): CompilerError {
    return new CompilerError(
      ErrorUtil.formatContext(message, pos, context),
      true,
      ErrorUtil.toStack(pos, context)
    );
  }

  static create(message: string, pos: PosInfo | null, context: CompilerContextLike): CompilerError {
    return new CompilerError(
      ErrorUtil.formatContext(message, pos, context),
      false,
      ErrorUtil.toStack(pos, context)
    );
  }
}

export const ErrorUtil = {
  format(message: string, pos: PosInfo | null): string {
    if (!pos) {
      return message;
    }
    return `${pos.file}:${pos.line}:${pos.col + 1}: ${message}`;
  },

  formatWithStack(message: string, stack: (PosInfo | null)[]): string {
    let res = message;
    for (const pos of stack) {
      if (!pos) {
        res += "\n\tat <unknown>";
      } else {
        res += `\n\tat ${pos.file}:${pos.line}:${pos.col + 1}`;
      }
    }
    return res;
  },

  formatContext(message: string, pos: PosInfo | null, context: CompilerContextLike): string {
    return ErrorUtil.formatWithStack(message, [...context.stack, pos]);
  },

  unexpectedToken(node: { pos?: PosInfo }, context: CompilerContextLike): string {
    const pos = node.pos ?? null;
    return ErrorUtil.formatContext(`Unexpected: ${JSON.stringify(node)}`, pos, context);
  },

  toStack(pos: PosInfo | null, context: CompilerContextLike): PosInfo[] {
    const entries = [pos, ...context.stack];
    return entries.filter((p): p is PosInfo => Boolean(p));
  },
};

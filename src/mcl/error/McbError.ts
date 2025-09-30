import { PosInfo } from "../Tokenizer";

export class McbError extends Error {
  mcbstack: PosInfo[];

  constructor(message: string, stack: PosInfo[]) {
    super(message);
    this.name = "McbError";
    this.mcbstack = stack;
  }

  static isMclError(e: unknown): e is McbError {
    return e instanceof McbError;
  }
}

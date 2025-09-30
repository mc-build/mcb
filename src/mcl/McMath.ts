import type { CompilerContext } from "./Compiler";
import { CompilerError } from "./error/CompilerError";

export type McMathCompileResult = {
  commands: string;
  constants: number[];
};

export function compile(_equation: string, context: CompilerContext): McMathCompileResult {
  throw CompilerError.create(
    "Equation parsing is not yet implemented in the TypeScript port. Please avoid using eq commands until math support is restored.",
    null,
    context
  );
}

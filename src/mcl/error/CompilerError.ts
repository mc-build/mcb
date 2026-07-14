import chalk from "chalk";
import { PosInfo } from "../Tokenizer";
import { SourceRegistry } from "../SourceRegistry";
import { McbError } from "./McbError";

export interface CompilerContextLike {
	stack: (PosInfo | null)[];
}

export class CompilerError extends McbError {
	readonly internal: boolean;

	constructor(message: string, internal: boolean, stack: PosInfo[]) {
		super(
			`${internal ? "Internal " : ""}Compiler Error:\n\t${ErrorUtil.render(message, stack)}`,
			stack,
		);
		this.internal = internal;
	}

	static createInternal(
		message: string,
		pos: PosInfo | null,
		context: CompilerContextLike,
	): CompilerError {
		return new CompilerError(message, true, ErrorUtil.toStack(pos, context));
	}

	static create(
		message: string,
		pos: PosInfo | null,
		context: CompilerContextLike,
	): CompilerError {
		return new CompilerError(message, false, ErrorUtil.toStack(pos, context));
	}
}

const MAX_CALL_CHAIN_FRAMES = 10;

export const ErrorUtil = {
	render(message: string, stack: PosInfo[]): string {
		const [primary, ...callers] = stack;
		let result = message;

		if (primary) {
			result += `\n\n  ${chalk.dim("-->")} ${primary.file}:${primary.line}:${primary.col + 1}`;
			const frame = ErrorUtil.codeFrame(primary);
			if (frame) {
				result += `\n${frame}`;
			}
		} else {
			result += "\n\tat <unknown>";
		}

		if (callers.length > 0) {
			result += `\n\n  Called from:`;
			const shown = callers.slice(0, MAX_CALL_CHAIN_FRAMES);
			for (const pos of shown) {
				result += `\n    at ${pos.file}:${pos.line}:${pos.col + 1}`;
			}
			const remaining = callers.length - shown.length;
			if (remaining > 0) {
				result += `\n    ... and ${remaining} more call${remaining === 1 ? "" : "s"}`;
			}
		}

		return result;
	},

	codeFrame(pos: PosInfo): string | null {
		const line = SourceRegistry.getLine(pos.file, pos.line);
		if (line === undefined) {
			return null;
		}
		const lineLabel = String(pos.line);
		const gutter = " ".repeat(lineLabel.length);
		const col = Math.max(0, pos.col);
		return [
			`    ${chalk.dim(`${gutter} |`)}`,
			`    ${chalk.dim(`${lineLabel} |`)} ${line}`,
			`    ${chalk.dim(`${gutter} |`)} ${" ".repeat(col)}${chalk.redBright("^")}`,
		].join("\n");
	},

	toStack(pos: PosInfo | null, context: CompilerContextLike): PosInfo[] {
		const entries = [pos, ...context.stack];
		return entries.filter((p): p is PosInfo => Boolean(p));
	},
};

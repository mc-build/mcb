import { StreamPosition } from "../StringStream";
import { McbError } from "./McbError";

export interface CompilerContextLike {
	stack: (StreamPosition | null)[];
}

export class CompilerError extends McbError {
	readonly internal: boolean;

	constructor(message: string, internal: boolean, stack: StreamPosition[]) {
		super(`${internal ? "Internal " : ""}Compiler Error:\n\t${message}`, stack);
		this.internal = internal;
	}

	static createInternal(
		message: string,
		pos: StreamPosition | null,
		context: CompilerContextLike,
	): CompilerError {
		return new CompilerError(
			ErrorUtil.formatContext(message, pos, context),
			true,
			ErrorUtil.toStack(pos, context),
		);
	}

	static create(
		message: string,
		pos: StreamPosition | null,
		context: CompilerContextLike,
	): CompilerError {
		return new CompilerError(
			ErrorUtil.formatContext(message, pos, context),
			false,
			ErrorUtil.toStack(pos, context),
		);
	}
}

export const ErrorUtil = {
	format(message: string, pos: StreamPosition | null): string {
		if (!pos) {
			return message;
		}
		return `${pos.srcFile}:${pos.line}:${pos.column + 1}: ${message}`;
	},

	formatWithStack(message: string, stack: (StreamPosition | null)[]): string {
		let res = message;
		for (const pos of stack) {
			if (!pos) {
				res += "\n\tat <unknown>";
			} else {
				res += `\n\tat ${pos.srcFile}:${pos.line}:${pos.column + 1}`;
			}
		}
		return res;
	},

	formatContext(
		message: string,
		pos: StreamPosition | null,
		context: CompilerContextLike,
	): string {
		return ErrorUtil.formatWithStack(message, [...context.stack, pos]);
	},

	unexpectedToken(
		node: { pos?: StreamPosition },
		context: CompilerContextLike,
	): string {
		const pos = node.pos ?? null;
		return ErrorUtil.formatContext(
			`Unexpected: ${JSON.stringify(node)}`,
			pos,
			context,
		);
	},

	toStack(
		pos: StreamPosition | null,
		context: CompilerContextLike,
	): StreamPosition[] {
		const entries = [pos, ...context.stack];
		return entries.filter((p): p is StreamPosition => Boolean(p));
	},
};

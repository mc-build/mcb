import { StreamPosition } from "../StringStream";

export class McbError extends Error {
	mcbstack: StreamPosition[];

	constructor(message: string, stack: StreamPosition[]) {
		super(message);
		this.name = "McbError";
		this.mcbstack = stack;
	}

	static isMcbError(e: unknown): e is McbError {
		return e instanceof McbError;
	}
}

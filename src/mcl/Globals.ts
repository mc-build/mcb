type LoopHandler = (
	...args: unknown[]
) => IterableIterator<unknown> | Iterator<unknown> | unknown;

class McFloatIterator implements IterableIterator<number> {
	private current: number;
	private readonly max: number;
	private readonly step: number;

	constructor(min: number, max: number, step: number) {
		if ((step < 0 && min < max) || (step > 0 && min > max)) {
			throw new Error("Invalid step for range");
		}
		this.current = min;
		this.max = max;
		this.step = step;
	}

	[Symbol.iterator](): IterableIterator<number> {
		return this;
	}

	next(): IteratorResult<number> {
		const done =
			this.step > 0 ? this.current > this.max : this.current < this.max;
		if (done) {
			return { done: true, value: undefined };
		}
		const value = this.current;
		this.current += this.step;
		return { done: false, value };
	}
}

class McIntIterator implements IterableIterator<number> {
	private current: number;
	private readonly max: number;
	private readonly step: number;

	constructor(min: number, max: number) {
		this.current = min;
		this.max = max;
		this.step = min <= max ? 1 : -1;
	}

	[Symbol.iterator](): IterableIterator<number> {
		return this;
	}

	next(): IteratorResult<number> {
		const done =
			this.step === 1 ? this.current > this.max : this.current < this.max;
		if (done) {
			return { done: true, value: undefined };
		}
		const value = this.current;
		this.current += this.step;
		return { done: false, value };
	}
}

const loopVariants: Array<{ signature: string; handler: LoopHandler }> = [
	{
		signature: "number,number",
		handler: (...args: unknown[]) => {
			const [min, max] = args as [number, number];
			return new McIntIterator(min, max);
		},
	},
	{
		signature: "number,number,number",
		handler: (...args: unknown[]) => {
			const [min, max, step] = args as [number, number, number];
			return new McFloatIterator(min, max, step);
		},
	},
	{
		signature: "array",
		handler: (...args: unknown[]) => {
			const [value] = args as [unknown[]];
			return (function* arrayIterator() {
				for (const entry of value) {
					yield entry;
				}
			})();
		},
	},
	{
		signature: "object",
		handler: (...args: unknown[]) => {
			const [value] = args as [Record<string, unknown>];
			return (function* objectIterator() {
				for (const entry of Object.entries(value)) {
					yield entry;
				}
			})();
		},
	},
	{
		signature: "function",
		handler: (...args: unknown[]) => {
			const [factory] = args as [
				() => IterableIterator<unknown> | Iterator<unknown>,
			];
			const iterator = factory();
			if (
				typeof (iterator as { [Symbol.iterator]?: () => Iterator<unknown> })[
					Symbol.iterator
				] === "function"
			) {
				return iterator;
			}
			return (function* fallback() {
				const result: unknown[] = [];
				// Non-standard iterator returning { next } without [Symbol.iterator]
				const iter = iterator as Iterator<unknown>;
				while (true) {
					const { value, done } = iter.next();
					if (done) break;
					result.push(value);
				}
				yield* result;
			})();
		},
	},
];

function selectLoopVariant(args: unknown[]): LoopHandler {
	for (const variant of loopVariants) {
		switch (variant.signature) {
			case "number,number":
				if (args.length === 2 && args.every((v) => typeof v === "number")) {
					return variant.handler as LoopHandler;
				}
				break;
			case "number,number,number":
				if (args.length === 3 && args.every((v) => typeof v === "number")) {
					return variant.handler as LoopHandler;
				}
				break;
			case "array":
				if (args.length === 1 && Array.isArray(args[0])) {
					return variant.handler as LoopHandler;
				}
				break;
			case "object":
				if (
					args.length === 1 &&
					args[0] &&
					typeof args[0] === "object" &&
					!Array.isArray(args[0])
				) {
					return variant.handler as LoopHandler;
				}
				break;
			case "function":
				if (args.length === 1 && typeof args[0] === "function") {
					return variant.handler as LoopHandler;
				}
				break;
			default:
				break;
		}
	}
	throw new Error(
		`Invalid arguments for REPEAT (${args.map((v) => typeof v).join(", ")})`,
	);
}

export const Globals = {
	map: new Map<string, any>([
		[
			"REPEAT",
			(...args: unknown[]) => {
				const handler = selectLoopVariant(args);
				return handler(...args);
			},
		],
	]),

	set(name: string, value: unknown): void {
		Globals.map.set(name, value);
	},

	get(name: string): unknown {
		return Globals.map.get(name);
	},

	has(name: string): boolean {
		return Globals.map.has(name);
	},

	delete(name: string): boolean {
		return Globals.map.delete(name);
	},
};

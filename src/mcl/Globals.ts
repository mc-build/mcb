type LoopHandler = (
	...args: unknown[]
) => IterableIterator<unknown> | Iterator<unknown> | unknown;

type TypeofType =
	| "string"
	| "number"
	| "bigint"
	| "boolean"
	| "symbol"
	| "undefined"
	| "object"
	| "function";
function match(type: TypeofType): { type: TypeofType } {
	return { type };
}
const loopVariants: Array<{
	signature: readonly { type: string; match?: (value: any) => boolean }[];
	handler: LoopHandler;
}> = [
	{
		signature: [match("number")],
		*handler(...args: unknown[]) {
			const [end] = args as [number];
			const actualMin = end > 0 ? 0 : end;
			const actualMax = end < 0 ? end : 0;
			const step = Math.sign(end);
			for (
				let i = step < 0 ? actualMax : actualMin;
				step < 0 ? i > actualMin : i < actualMax;
				i += step
			) {
				yield i;
			}
		},
	},
	{
		signature: [match("number"), match("number")],
		*handler(...args: unknown[]) {
			const [min, max] = args as [number, number];
			const actualMin = min < max ? min : max;
			const actualMax = min < max ? max : min;
			// Math.sign(max - min) is 0 when min === max, which would leave `i`
			// stuck forever while the "reached the end" check stays true
			// (i <= actualMax never becomes false). Force a non-zero step so a
			// single-value range (e.g. REPEAT(5, 5)) yields once and stops -
			// this is what nested REPEATs hit whenever an inner range's bounds
			// happen to be equal on some outer iteration.
			const step = Math.sign(max - min) || 1;
			for (
				let i = step < 0 ? actualMax : actualMin;
				step < 0 ? i >= actualMin : i <= actualMax;
				i += step
			) {
				yield i;
			}
		},
	},
	{
		signature: [match("number"), match("number"), match("number")],
		// Not a generator: a step of 0 must be rejected before any iteration
		// starts (throwing from inside a generator body would only surface
		// once the loop is first iterated, deep inside the compiler loop,
		// instead of as a normal compiler error at the REPEAT() call).
		handler: (...args: unknown[]) => {
			const [min, max, step] = args as [number, number, number];
			if (step === 0) {
				throw new Error(
					`REPEAT step must not be 0 (min=${min}, max=${max}) - this would loop forever`,
				);
			}
			const actualMin = min < max ? min : max;
			const actualMax = min < max ? max : min;
			return (function* () {
				for (
					let i = step < 0 ? actualMax : actualMin;
					step < 0 ? i >= actualMin : i <= actualMax;
					i += step
				) {
					yield i;
				}
			})();
		},
	},
	{
		signature: [{ type: "object", match: Array.isArray.bind(Array) }],
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
		signature: [match("object")],
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
		signature: [match("function")],
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
	const types = args.map((arg) => typeof arg);
	for (const variant of loopVariants) {
		if (
			variant.signature.length === args.length &&
			variant.signature.every(
				(kind, index) =>
					types[index] === kind.type &&
					(kind?.match ? kind.match(args[index]) : true),
			)
		) {
			return variant.handler;
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

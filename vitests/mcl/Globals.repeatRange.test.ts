import { describe, expect, it } from "vitest";
import { Globals } from "../../src/mcl/Globals";

function collect(iterable: Iterable<unknown>, limit: number): unknown[] {
	const out: unknown[] = [];
	for (const value of iterable) {
		out.push(value);
		if (out.length > limit) {
			// Bail out instead of looping forever if the generator is broken -
			// a failed assertion below is much more useful than a hung test run.
			// (A hang here would be a *synchronous* infinite loop, which no
			// test-runner timeout can interrupt, so this guard is load-bearing,
			// not just a nicety.)
			break;
		}
	}
	return out;
}

/**
 * Regression test: the numeric-range REPEAT() variants computed their step
 * as Math.sign(max - min), which is 0 whenever min === max. With a step of
 * 0, `i` never advances but the "keep going" condition (i <= actualMax)
 * stays true forever, so the generator never terminated. Nested REPEATs hit
 * this naturally whenever an inner range's bounds happen to coincide on some
 * outer iteration (e.g. REPEAT(i, N) as the outer i reaches N) - a
 * triangular iteration like "for i in 0..3, for j in i..3" - which is
 * exactly what made "nested REPEAT hangs" so easy to trigger by accident.
 *
 * These tests exercise Globals' REPEAT() directly (not the full compiler
 * pipeline): the underlying bug is a synchronous infinite loop, which no
 * test-runner timeout can interrupt, so routing this through
 * Compiler.compile() would turn a regression into a hung test run instead of
 * a fast, readable failure.
 */
describe("REPEAT() numeric range variants", () => {
	const REPEAT = Globals.map.get("REPEAT") as (
		...args: unknown[]
	) => Iterable<unknown>;

	it("yields exactly once for a two-arg range whose min and max are equal", () => {
		expect(collect(REPEAT(5, 5), 10)).toEqual([5]);
	});

	it("still yields the normal ascending/descending range when min !== max", () => {
		expect(collect(REPEAT(1, 3), 10)).toEqual([1, 2, 3]);
		expect(collect(REPEAT(3, 1), 10)).toEqual([3, 2, 1]);
	});

	it("throws instead of hanging when an explicit three-arg step is 0", () => {
		expect(() => collect(REPEAT(0, 3, 0), 10)).toThrow(/step must not be 0/);
	});

	it("still yields the normal range for a non-zero three-arg step", () => {
		expect(collect(REPEAT(0, 10, 2), 20)).toEqual([0, 2, 4, 6, 8, 10]);
	});

	it("does not hang on a single-value one-arg range (REPEAT(0))", () => {
		expect(collect(REPEAT(0), 10)).toEqual([]);
	});

	it("resolves a triangular nested REPEAT (inner bounds coincide on the last outer step) without hanging", () => {
		// Simulates `REPEAT(0, 3) as i { REPEAT(i, 3) as j { ... } }` by
		// composing REPEAT() calls directly, the same way the compiler's
		// nested CompileTimeLoop handling does.
		const pairs: [number, number][] = [];
		for (const i of collect(REPEAT(0, 3), 10) as number[]) {
			for (const j of collect(REPEAT(i, 3), 10) as number[]) {
				pairs.push([i, j]);
			}
		}
		expect(pairs).toContainEqual([0, 0]);
		expect(pairs).toContainEqual([1, 2]);
		// The boundary case that used to hang: i === 3 makes REPEAT(3, 3).
		expect(pairs).toContainEqual([3, 3]);
		expect(pairs).toHaveLength(10);
	});
});

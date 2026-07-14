import { describe, expect, it } from "vitest";
import { PosInfo } from "../../../src/mcl/Tokenizer";
import { SourceRegistry } from "../../../src/mcl/SourceRegistry";
import { CompilerError, ErrorUtil } from "../../../src/mcl/error/CompilerError";
import { McbError } from "../../../src/mcl/error/McbError";

function pos(file: string, line: number, col: number): PosInfo {
	return { file, line, col };
}

describe("ErrorUtil.render", () => {
	it("falls back to 'at <unknown>' when there is no position", () => {
		const result = ErrorUtil.render("something broke", []);
		expect(result).toBe("something broke\n\tat <unknown>");
	});

	it("prints a location line for the primary frame even without registered source", () => {
		const result = ErrorUtil.render("bad thing", [
			pos("error-util-test/no-source.mcb", 4, 2),
		]);
		expect(result).toContain(
			"--> error-util-test/no-source.mcb:4:3",
		);
		// no source registered for this file, so no code frame lines should appear
		expect(result).not.toContain("|");
	});

	it("renders a code frame with a caret aligned to the column", () => {
		SourceRegistry.register(
			"error-util-test/with-source.mcb",
			"function tick {\n    say hi\n}",
		);
		const result = ErrorUtil.render("bad command", [
			pos("error-util-test/with-source.mcb", 2, 4),
		]);
		const lines = result.split("\n");
		expect(lines.some((line) => line.includes("say hi"))).toBe(true);
		const caretLine = lines.find((line) => line.includes("^"));
		expect(caretLine).toBeDefined();
		// the caret must line up under the 's' of 'say' (column 4, 0-indexed)
		const sourceLine = lines.find((line) => line.includes("say hi"))!;
		const sColumnInFrame = sourceLine.indexOf("say hi");
		expect(caretLine!.indexOf("^")).toBe(sColumnInFrame);
	});

	it("lists the call chain innermost-first, after the primary frame", () => {
		const result = ErrorUtil.render("deep error", [
			pos("c.mcbt", 3, 1),
			pos("b.mcbt", 5, 2),
			pos("a.mcb", 7, 3),
		]);
		expect(result).toContain("--> c.mcbt:3:2");
		expect(result).toContain("Called from:");
		const calledFromIdx = result.indexOf("Called from:");
		const bIdx = result.indexOf("at b.mcbt:5:3");
		const aIdx = result.indexOf("at a.mcb:7:4");
		expect(bIdx).toBeGreaterThan(calledFromIdx);
		expect(aIdx).toBeGreaterThan(bIdx);
	});

	it("omits the 'Called from' block when there is no call chain", () => {
		const result = ErrorUtil.render("shallow error", [pos("only.mcb", 1, 0)]);
		expect(result).not.toContain("Called from:");
	});

	it("caps the call chain and reports how many frames were hidden", () => {
		// stack[0] is the primary/throw-site frame; stack[1..13] are 13 callers.
		// Only the first 10 callers should be printed, leaving 3 hidden.
		const stack = Array.from({ length: 14 }, (_, i) =>
			pos(`frame-${i}.mcb`, i + 1, 0),
		);
		const result = ErrorUtil.render("deep recursion", stack);
		expect(result).toContain("... and 3 more calls");
		expect(result).toContain("frame-10.mcb");
		expect(result).not.toContain("frame-11.mcb");
		expect(result).not.toContain("frame-12.mcb");
		expect(result).not.toContain("frame-13.mcb");
	});
});

describe("ErrorUtil.toStack", () => {
	it("puts the throw-site position first, then the call chain", () => {
		const stack = ErrorUtil.toStack(pos("throw-site.mcb", 1, 0), {
			stack: [pos("caller.mcb", 2, 0)],
		});
		expect(stack).toEqual([pos("throw-site.mcb", 1, 0), pos("caller.mcb", 2, 0)]);
	});

	it("filters out null entries", () => {
		const stack = ErrorUtil.toStack(null, {
			stack: [null, pos("caller.mcb", 2, 0)],
		});
		expect(stack).toEqual([pos("caller.mcb", 2, 0)]);
	});
});

describe("CompilerError", () => {
	it("is recognized by McbError.isMclError", () => {
		const error = CompilerError.create("oops", null, { stack: [] });
		expect(McbError.isMclError(error)).toBe(true);
	});

	it("prefixes normal errors with 'Compiler Error:'", () => {
		const error = CompilerError.create("oops", null, { stack: [] });
		expect(error.internal).toBe(false);
		expect(error.message.startsWith("Compiler Error:\n\toops")).toBe(true);
	});

	it("prefixes internal errors with 'Internal Compiler Error:'", () => {
		const error = CompilerError.createInternal("oops", null, { stack: [] });
		expect(error.internal).toBe(true);
		expect(error.message.startsWith("Internal Compiler Error:\n\toops")).toBe(true);
	});

	it("stores the throw-site + call chain on mcbstack", () => {
		const error = CompilerError.create("oops", pos("site.mcb", 1, 0), {
			stack: [pos("caller.mcb", 2, 0)],
		});
		expect(error.mcbstack).toEqual([
			pos("site.mcb", 1, 0),
			pos("caller.mcb", 2, 0),
		]);
	});
});

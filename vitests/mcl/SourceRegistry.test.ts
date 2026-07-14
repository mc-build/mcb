import { describe, expect, it } from "vitest";
import { SourceRegistry } from "../../src/mcl/SourceRegistry";

describe("SourceRegistry", () => {
	it("returns the requested line of a registered file", () => {
		SourceRegistry.register("registry-test/basic.mcb", "line one\nline two\nline three");
		expect(SourceRegistry.getLine("registry-test/basic.mcb", 1)).toBe("line one");
		expect(SourceRegistry.getLine("registry-test/basic.mcb", 2)).toBe("line two");
		expect(SourceRegistry.getLine("registry-test/basic.mcb", 3)).toBe("line three");
	});

	it("returns undefined for an unregistered file", () => {
		expect(SourceRegistry.getLine("registry-test/does-not-exist.mcb", 1)).toBeUndefined();
	});

	it("returns undefined for an out-of-range line", () => {
		SourceRegistry.register("registry-test/short.mcb", "only line");
		expect(SourceRegistry.getLine("registry-test/short.mcb", 2)).toBeUndefined();
		expect(SourceRegistry.getLine("registry-test/short.mcb", 0)).toBeUndefined();
	});

	it("does not overwrite an already-registered file", () => {
		SourceRegistry.register("registry-test/stable.mcb", "original");
		SourceRegistry.register("registry-test/stable.mcb", "replaced");
		expect(SourceRegistry.getLine("registry-test/stable.mcb", 1)).toBe("original");
	});

	it("splits on \\r\\n and lone \\r as well as \\n", () => {
		SourceRegistry.register("registry-test/crlf.mcb", "a\r\nb\rc\nd");
		expect(SourceRegistry.getLine("registry-test/crlf.mcb", 1)).toBe("a");
		expect(SourceRegistry.getLine("registry-test/crlf.mcb", 2)).toBe("b");
		expect(SourceRegistry.getLine("registry-test/crlf.mcb", 3)).toBe("c");
		expect(SourceRegistry.getLine("registry-test/crlf.mcb", 4)).toBe("d");
	});

	it("preserves leading whitespace so caret columns line up", () => {
		SourceRegistry.register("registry-test/indent.mcb", "    indented command");
		expect(SourceRegistry.getLine("registry-test/indent.mcb", 1)).toBe(
			"    indented command",
		);
	});
});

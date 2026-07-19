import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Config } from "../../src/mcl/Config";

/**
 * Regression test: Config.create() used to always look for pack.mcmeta at
 * process.cwd(), ignoring the project's actual base directory. Building a
 * project via `--base <dir>` from outside that directory (e.g. from a repo
 * root, or via the library API) would silently miss the real pack.mcmeta and
 * report a misleading "this may be the result of a parsing error" message,
 * even though the file was never read from the right place.
 */
describe("Config.create pack.mcmeta directory resolution", () => {
	const tempDirs: string[] = [];

	function makeProjectDir(packMcmeta: string): string {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcb-config-test-"));
		fs.writeFileSync(path.join(dir, "pack.mcmeta"), packMcmeta);
		tempDirs.push(dir);
		return dir;
	}

	afterEach(() => {
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop()!;
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("reads pack_format from the given projectDir, not process.cwd()", () => {
		const dir = makeProjectDir(
			JSON.stringify({ pack: { pack_format: 55 } }),
		);
		expect(dir).not.toBe(process.cwd());

		const config = Config.create({}, dir);
		expect(config.formatVersion).toBe(55);
	});

	it("prefers an explicit formatVersion over pack.mcmeta", () => {
		const dir = makeProjectDir(JSON.stringify({ pack: { pack_format: 55 } }));
		const config = Config.create({ formatVersion: 7 }, dir);
		expect(config.formatVersion).toBe(7);
	});
});

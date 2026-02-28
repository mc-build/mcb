import { expect } from "vitest";
import { isAbsolute, join, parse } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { Tokenizer } from "../src/mcl/Tokenizer";

const ABSOLUTE_TESTS_PATH = __dirname;

/**
 * Reads a file at {@link path} relative to the `vitests` folder.
 */
export async function read(path: string) {
	return await readFile(join(__dirname, path), "utf-8");
}

/**
 * Expects {@link actual} string to match the contents of the file at {@link path}.
 *
 * If the expected file does not exist, it is created with the current {@link actual} contents.
 *
 * @param path Must be an absolute path inside the `vitests` folder this file is in.
 *
 * ```ts
 * await expectToMatchFile("some output", join(__dirname, "output.txt"));
 * ```
 */
export async function expectToMatchFile(actual: string, path: string) {
	// Paths must be absolute because we can't get the `__dirname` of the caller.
	if (!isAbsolute(path)) throw new Error("Path must be absolute: " + path);
	// Prevent accidental writes outside of the vitests folder.
	if (!path.startsWith(ABSOLUTE_TESTS_PATH)) {
		throw new Error("Path must be inside vitests folder: " + path);
	}

	const parsed = parse(path);
	await mkdir(parsed.dir, { recursive: true });

	const withoutExt = join(parsed.dir, parsed.name);
	const actualPath = `${withoutExt}.actual${parsed.ext}`;
	await writeFile(actualPath, actual, "utf-8");

	const expectedPath = `${withoutExt}.expected${parsed.ext}`;
	if (!existsSync(expectedPath)) {
		console.warn("Creating expected file:", expectedPath);
		// Create the expected file from our current output if it doesn't exist
		await writeFile(expectedPath, actual, "utf-8");
	}
	const expected = await readFile(expectedPath, "utf-8");

	expect(actual).toBe(expected);
}

export async function tokenize(srcFile: string) {
	const parsed = parse(srcFile);
	const source = await read(srcFile);
	return new Tokenizer(source, parsed.base).tokenize();
}

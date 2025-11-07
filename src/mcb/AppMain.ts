import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { performance } from "node:perf_hooks";

import chokidar from "chokidar";

import { Compiler, VariableMap } from "../mcl/Compiler";
import { TemplateRegisterer } from "../mcl/TemplateRegisterer";
import { Tokenizer } from "../mcl/TokenizerImpl";
import { Parser } from "../mcl/Parser";
import { McbError } from "../mcl/error/McbError";
import { Logger } from "./Logger";
import { SyncIo } from "./io/SyncIo";

export type BuildOpts = {
	watch: boolean;
	baseDir: string;
	libDir: string;
	configPath: string;
};

type DoneCallback = (compiler: Compiler) => void | Promise<void>;

type JsonSummary = {
	data_pack_version: number;
};

const globalJsData: Record<string, unknown> = {};

function resolveTemplateDirectory(): string {
	const candidates: string[] = [];

	const scriptArg = process.argv[1];
	if (scriptArg) {
		try {
			const resolved = fs.realpathSync(scriptArg);
			candidates.push(path.join(path.dirname(resolved), "template"));
		} catch (error) {
			Logger.warn(`Failed to resolve CLI path '${scriptArg}': ${error}`);
		}
	}

	try {
		const resolvedFile = fs.realpathSync(__filename);
		candidates.push(path.join(path.dirname(resolvedFile), "template"));
	} catch (error) {
		Logger.warn(`Failed to resolve current file path: ${error}`);
	}

	candidates.push(path.join(path.resolve(__dirname, ".."), "template"));

	for (const candidate of candidates) {
		if (candidate && fs.existsSync(candidate)) {
			return candidate;
		}
	}

	try {
		const resolvedTemplateFile = require.resolve("../template/mcb.config.js");
		const candidate = path.dirname(resolvedTemplateFile);
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	} catch (error) {
		Logger.warn(`Failed to resolve template via require.resolve: ${error}`);
	}

	throw new Error(
		"Unable to locate template directory. Please ensure the package was built correctly.",
	);
}

function discoverConfigFile(configPath: string): string {
	const candidates = [".cjs", ".js", ".json"];
	for (const extension of candidates) {
		const candidate = `${configPath}${extension}`;
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}
	return configPath;
}

function getFilesInDirectory(dir: string): string[] {
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	const result: string[] = [];
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			result.push(...getFilesInDirectory(fullPath));
		} else {
			result.push(fullPath);
		}
	}
	return result;
}

function loadConfig(resolvedPath: string): Record<string, unknown> {
	if (!fs.existsSync(resolvedPath)) {
		Logger.warn(
			`Config file not found, using default config (${resolvedPath}).`,
		);
		return {};
	}

	try {
		const modulePath = require.resolve(resolvedPath);
		delete require.cache[modulePath];
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const configModule = require(modulePath);
		return configModule.default ?? configModule;
	} catch (error) {
		Logger.error(`Failed to load config file: ${resolvedPath}`);
		throw error;
	}
}

function createVariableRoot(config: Record<string, unknown>): VariableMap {
	const variables = new Map<string, unknown>();
	variables.set("config", config);
	variables.set("global", globalJsData);
	variables.set("store", {});
	return VariableMap.globals.fork(variables);
}

function formatDuration(start: number, end: number): string {
	return ((end - start) / 1000).toFixed(2);
}

function ensureDirectory(dir: string): void {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
}

async function fetchVersionSummary(): Promise<JsonSummary> {
	return new Promise((resolve, reject) => {
		https
			.get(
				"https://raw.githubusercontent.com/misode/mcmeta/summary/version.json",
				(res) => {
					if (res.statusCode && res.statusCode >= 400) {
						reject(
							new Error(`Failed to fetch version summary: ${res.statusCode}`),
						);
						res.resume();
						return;
					}

					res.setEncoding("utf8");
					let body = "";
					res.on("data", (chunk) => {
						body += chunk;
					});
					res.on("end", () => {
						try {
							const json = JSON.parse(body);
							resolve(json as JsonSummary);
						} catch (error) {
							reject(error);
						}
					});
				},
			)
			.on("error", reject);
	});
}

function applyTemplate(
	content: string,
	values: Record<string, string | number>,
): string {
	let result = content;
	for (const [key, value] of Object.entries(values)) {
		const token = new RegExp(`::${key}::`, "g");
		result = result.replace(token, String(value));
	}
	return result;
}

function resolvePath(baseDir: string, target: string): string {
	if (path.isAbsolute(target)) {
		return target;
	}
	return path.join(baseDir, target);
}

async function executeCallback(
	callback: DoneCallback | undefined,
	compiler: Compiler,
): Promise<void> {
	if (!callback) {
		return;
	}
	await callback(compiler);
}

function isSyncIo(io: unknown): io is SyncIo {
	return Boolean(io) && io instanceof SyncIo;
}

export async function create(name: string): Promise<void> {
	const templateDir = resolveTemplateDirectory();
	const destDir = path.join(process.cwd(), name);
	ensureDirectory(destDir);

	let summary: JsonSummary;
	try {
		summary = await fetchVersionSummary();
	} catch (error) {
		Logger.warn(`Failed to fetch version summary: ${error}`);
		summary = { data_pack_version: 48 };
	}

	const replacements = { name, version: summary.data_pack_version };

	const copyDir = (from: string, to: string) => {
		const entries = fs.readdirSync(from, { withFileTypes: true });
		for (const entry of entries) {
			const fromPath = path.join(from, entry.name);
			const toPath = path.join(to, entry.name);
			if (entry.isDirectory()) {
				ensureDirectory(toPath);
				copyDir(fromPath, toPath);
			} else {
				const template = fs.readFileSync(fromPath, "utf8");
				const content = applyTemplate(template, replacements);
				ensureDirectory(path.dirname(toPath));
				fs.writeFileSync(toPath, content, "utf8");
			}
		}
	};

	copyDir(templateDir, destDir);
	Logger.log(`Created project ${name} in ${destDir}`);
}

function readCache(cacheFile: string): Map<string, string> {
	if (!fs.existsSync(cacheFile)) {
		return new Map();
	}
	const entries = fs
		.readFileSync(cacheFile, "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => line.split(":"));
	const result = new Map<string, string>();
	for (const [file, hash] of entries) {
		if (file) {
			result.set(file, hash);
		}
	}
	return result;
}

function writeCache(cacheFile: string, cache: Map<string, string>): void {
	ensureDirectory(path.dirname(cacheFile));
	const payload = Array.from(cache.entries())
		.map(([file, hash]) => `${file}:${hash}`)
		.join("\n");
	fs.writeFileSync(cacheFile, payload, "utf8");
}

function handleUpdatingFilesBasedOnCache(
	io: SyncIo,
	cache: Map<string, string>,
): Map<string, string> {
	const added = io.reportFilesAdded(cache);
	const removed = io.reportFilesRemoved(cache);
	const changed = io.reportFilesChanged(cache);

	for (const file of removed) {
		if (fs.existsSync(file)) {
			fs.rmSync(file, { force: true });
		}
	}

	const seenDirs = new Set<string>();
	for (const file of [...removed]) {
		const dir = path.dirname(file);
		if (
			!seenDirs.has(dir) &&
			fs.existsSync(dir) &&
			fs.statSync(dir).isDirectory()
		) {
			seenDirs.add(dir);
		}
	}

	for (const dir of seenDirs) {
		try {
			const contents = fs.readdirSync(dir);
			if (contents.length === 0) {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		} catch (error) {
			Logger.warn(`Failed to clean directory ${dir}: ${error}`);
		}
	}

	if (added.length > 0 || removed.length > 0 || changed.length > 0) {
		Logger.log(`↑ Added: ${added.length}`);
		Logger.log(`↓ Removed: ${removed.length}`);
		Logger.log(`→ Changed: ${changed.length}`);
	}

	return io.reportFileMetadata();
}

async function runCompile(
	opts: BuildOpts,
	callback?: DoneCallback,
): Promise<Compiler> {
	const resolvedBaseDir = path.resolve(opts.baseDir);
	const srcDir = path.join(resolvedBaseDir, "src");
	const resolvedConfigPath = discoverConfigFile(
		resolvePath(resolvedBaseDir, opts.configPath),
	);
	const config = loadConfig(resolvedConfigPath);
	const compilerBaseDir = srcDir;
	const compiler = new Compiler(compilerBaseDir, config);
	const io = new SyncIo();
	compiler.io = io;

	let didFail = true;
	const start = performance.now();

	const handleError = (error: unknown) => {
		didFail = true;
		if (McbError.isMclError(error)) {
			Logger.error(error.message);
		} else {
			Logger.error(
				"A fatal error occurred during compilation. Please report this to the developers.",
			);
			throw error;
		}
	};

	try {
		await compiler.config.events.onPreBuild.dispatch({});

		const sourceFiles = getFilesInDirectory(srcDir);
		for (const file of sourceFiles) {
			const ext = path.extname(file);
			if (ext !== ".mcb" && ext !== ".mcbt") {
				continue;
			}
			const content = fs.readFileSync(file, "utf8");
			const tokens = Tokenizer.tokenize(content, file);
			const ast =
				ext === ".mcb"
					? Parser.parseMcbFile(tokens)
					: Parser.parseMcbtFile(tokens);
			compiler.addFile(file, ast);
		}

		const root = createVariableRoot(config);
		compiler.compile(root);
		didFail = !compiler.success;
	} catch (error) {
		handleError(error);
	}

	try {
		await compiler.config.events.onPostBuild.dispatch({ success: !didFail });
	} finally {
		const end = performance.now();
		Logger.log(`Build finished in ${formatDuration(start, end)} seconds`);
		let callbackError: unknown;
		try {
			await executeCallback(callback, compiler);
		} catch (error) {
			callbackError = error;
		}
		if (callbackError) {
			throw callbackError;
		}
	}

	return compiler;
}

export async function compile(
	opts: BuildOpts,
	callback?: DoneCallback,
): Promise<Compiler> {
	Logger.log(`Started build at ${new Date().toISOString()}`);
	return runCompile(opts, callback);
}

export async function doBuild(opts: BuildOpts): Promise<void> {
	TemplateRegisterer.register();
	const cacheFile = path.join(opts.baseDir, ".mcb", "fs-cache.txt");
	let cache = readCache(cacheFile);

	const performBuild = async () => {
		try {
			const compiler = await compile(opts, async (instance) => {
				if (instance.success && isSyncIo(instance.io)) {
					cache = handleUpdatingFilesBasedOnCache(instance.io, cache);
					writeCache(cacheFile, cache);
				} else if (isSyncIo(instance.io)) {
					Logger.warn("Reverting file changes...");
					instance.io.revertTracker.revert();
				}
			});
			if (!isSyncIo(compiler.io)) {
				Logger.warn("Build IO implementation does not support cache tracking.");
			}
		} catch (error) {
			if (!McbError.isMclError(error)) {
				throw error;
			}
		}
	};

	await performBuild();

	if (!opts.watch) {
		return;
	}

	Logger.log("Watch mode enabled, watching for changes...");
	const watcher = chokidar.watch(path.join(opts.baseDir, "src"), {
		ignoreInitial: true,
		awaitWriteFinish: true,
	});

	let building = false;
	let pending = false;

	const triggerBuild = () => {
		if (building) {
			pending = true;
			return;
		}
		building = true;
		performBuild()
			.catch((error) => {
				if (!McbError.isMclError(error)) {
					Logger.error(error);
				}
			})
			.finally(() => {
				building = false;
				if (pending) {
					pending = false;
					triggerBuild();
				} else {
					Logger.log("Watching for changes...");
				}
			});
	};

	watcher.on("all", (event, filePath) => {
		Logger.log(`File change detected (${event}): ${filePath}`);
		triggerBuild();
	});
}

export async function generate(
	outfile: string,
	arg: { libDir: string; baseDir: string; configPath: string },
): Promise<void> {
	const resolvedBaseDir = path.resolve(arg.baseDir);
	const resolvedOutfile = resolvePath(resolvedBaseDir, outfile);
	const resolvedConfigPath = discoverConfigFile(
		resolvePath(resolvedBaseDir, arg.configPath),
	);
	const config = loadConfig(resolvedConfigPath);
	const compiler = new Compiler(resolvedBaseDir, config);
	const content = fs.readFileSync(resolvedOutfile, "utf8");
	const tokens = Tokenizer.tokenize(content, resolvedOutfile);
	const ast = Parser.parseMcbFile(tokens);
	compiler.addFile(resolvedOutfile, ast);
	const root = createVariableRoot(config);
	compiler.transform(root);
}

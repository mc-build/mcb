import {
	Directive,
	Expression,
	parse,
	Statement,
	visitorKeys,
} from "oxc-parser";
import MagicString from "magic-string";
import { readFile, readdir, writeFile } from "fs/promises";
import { dirname, extname, relative, resolve } from "path";

type SourceType = "commonjs" | "module";

function getDefaultOutput(inputPath: string): string {
	if (inputPath.endsWith(".js")) {
		return `${inputPath.slice(0, -3)}.perf.js`;
	}
	return `${inputPath}.perf.js`;
}

async function parseWithSourceType(code: string) {
	const looksLikeModule = /^\s*(import|export)\s/m.test(code);
	const sourceTypes: SourceType[] = looksLikeModule
		? ["module", "commonjs"]
		: ["commonjs", "module"];
	for (const sourceType of sourceTypes) {
		try {
			const ast = await parse("input.js", code, {
				lang: "js",
				astType: "js",
				sourceType,
			});
			return { ast, sourceType };
		} catch {
			// Try next source type.
		}
	}
	throw new Error("Unable to parse input as CommonJS or ESM JavaScript");
}

function buildPerfRuntime(sourceType: SourceType): string {
	const summarize =
		`Object.entries(_perf.times).map(([id,stats])=>{const msTime=stats.time/1000;const totalMsTime=stats.total_time/1000;return{id,...stats,time_ms:msTime,total_time_ms:totalMsTime,avg_ms:msTime/stats.count,avg_total_time_ms:totalMsTime/stats.count,...(_perf.functions[id]||{})};}).sort((a,b)=>b.total_time-a.total_time)`;

	if (sourceType === "module") {
		return `var perf_stack;const _perf={functions:{},times:{}};function perf_register(id,pos,name,meta){_perf.functions[id]={pos,name,meta};_perf.times[id]={time:0,total_time:0,count:0};}function perf_track(id,time){var a;(a=_perf.times[id]).time+=time;a.count++;}function perf_track_total(id,time){var a;(a=_perf.times[id]).total_time+=time;}function perf_begin(id,time){perf_stack=perf_stack||[];perf_stack.push({id,start:time,child:0});}function perf_end(time){const frame=perf_stack&&perf_stack.pop();if(!frame)return;const elapsed=time-frame.start;const self=elapsed-frame.child;perf_track(frame.id,self);perf_track_total(frame.id,elapsed);if(perf_stack.length)perf_stack[perf_stack.length-1].child+=elapsed;}function perf_start(){for(const id in _perf.functions){const t=_perf.times[id];if(t){t.time=0;t.total_time=0;t.count=0;}else{_perf.times[id]={time:0,total_time:0,count:0};}}if(perf_stack)perf_stack.length=0;}function perf_stop(){return ${summarize};}\n`;
	}

	return `var perf_stack;const _perf={functions:{},times:{}};function perf_register(id,pos,name,meta){_perf.functions[id]={pos,name,meta};_perf.times[id]={time:0,total_time:0,count:0};}function perf_track(id,time){var a;(a=_perf.times[id]).time+=time;a.count++;}function perf_track_total(id,time){var a;(a=_perf.times[id]).total_time+=time;}function perf_begin(id,time){perf_stack=perf_stack||[];perf_stack.push({id,start:time,child:0});}function perf_end(time){const frame=perf_stack&&perf_stack.pop();if(!frame)return;const elapsed=time-frame.start;const self=elapsed-frame.child;perf_track(frame.id,self);perf_track_total(frame.id,elapsed);if(perf_stack.length)perf_stack[perf_stack.length-1].child+=elapsed;}function perf_start(){for(const id in _perf.functions){const t=_perf.times[id];if(t){t.time=0;t.total_time=0;t.count=0;}else{_perf.times[id]={time:0,total_time:0,count:0};}}if(perf_stack)perf_stack.length=0;}function perf_stop(){return ${summarize};}function perf_log(){const fs=require("node:fs");fs.writeFileSync("./meta.json",JSON.stringify(perf_stop(),null,"\\t"));}\n`;
}
function getRuntimeInsertIndex(code: string): number {
	if (code.startsWith("#!")) {
		const shebangEnd = code.indexOf("\n");
		return shebangEnd === -1 ? code.length : shebangEnd + 1;
	}
	return 0;
}

const SHARED_RUNTIME_FILE = "__mcb_perf_runtime.perf.js";

function getSharedRuntimeModuleCode(): string {
	return `const __perfShared=globalThis.__mcb_perf_shared||(globalThis.__mcb_perf_shared={functions:{},times:{},stack:[]});const _perf={functions:__perfShared.functions,times:__perfShared.times};const perf_stack=__perfShared.stack;export function perf_register(id,pos,name,meta){if(!_perf.functions[id])_perf.functions[id]={pos,name,meta};if(!_perf.times[id])_perf.times[id]={time:0,total_time:0,count:0};}export function perf_track(id,time){var a;(a=_perf.times[id]).time+=time;a.count++;}export function perf_track_total(id,time){var a;(a=_perf.times[id]).total_time+=time;}export function perf_begin(id,time){perf_stack.push({id,start:time,child:0});}export function perf_end(time){const frame=perf_stack.pop();if(!frame)return;const elapsed=time-frame.start;const self=elapsed-frame.child;perf_track(frame.id,self);perf_track_total(frame.id,elapsed);if(perf_stack.length)perf_stack[perf_stack.length-1].child+=elapsed;}export function perf_start(){for(const id in __perfShared.functions){const t=__perfShared.times[id];if(t){t.time=0;t.total_time=0;t.count=0;}else{__perfShared.times[id]={time:0,total_time:0,count:0};}}__perfShared.stack.length=0;}export function perf_stop(){return Object.entries(_perf.times).map(([id,stats])=>{const msTime=stats.time/1000;const totalMsTime=stats.total_time/1000;return{id,...stats,time_ms:msTime,total_time_ms:totalMsTime,avg_ms:msTime/stats.count,avg_total_time_ms:totalMsTime/stats.count,...(_perf.functions[id]||{})};}).sort((a,b)=>b.total_time-a.total_time);}\n`;
}

function toPerfModuleSpecifier(specifier: string): string {
	if (!specifier.startsWith(".")) return specifier;
	if (specifier.endsWith(".perf.js")) return specifier;
	if (specifier.endsWith(".js")) return `${specifier.slice(0, -3)}.perf.js`;
	return `${specifier}.perf`;
}

function rewriteModuleSpecifiers(content: MagicString, fc: string): void {
	const patterns = [
		/(from\s+["'])([^"']+)(["'])/g,
		/(import\s*\(\s*["'])([^"']+)(["']\s*\))/g,
		/(export\s+\*\s+from\s+["'])([^"']+)(["'])/g,
	];

	for (const pattern of patterns) {
		for (const match of fc.matchAll(pattern)) {
			const full = match[0];
			const prefix = match[1];
			const specifier = match[2];
			const suffix = match[3];
			const start = match.index ?? -1;
			if (start < 0) continue;
			const updated = toPerfModuleSpecifier(specifier);
			if (updated === specifier) continue;
			content.overwrite(start, start + full.length, `${prefix}${updated}${suffix}`);
		}
	}
}

async function transformFile(inputPath: string, outputPath: string, options?: {
	appendLog?: boolean;
	rewriteRelativeImportsToPerf?: boolean;
	moduleSharedRuntime?: boolean;
	runtimeImportSpecifier?: string;
	exportPerfApi?: boolean;
}) {
	const fc = await readFile(inputPath, "utf8");
	const content = new MagicString(fc);
	const { ast: x, sourceType } = await parseWithSourceType(content.toString());
	const runtimeInsertIndex = getRuntimeInsertIndex(fc);
	let runtimeCode = buildPerfRuntime(sourceType);

	if (sourceType === "module" && options?.moduleSharedRuntime) {
		const specifier = options.runtimeImportSpecifier ?? `./${SHARED_RUNTIME_FILE}`;
		runtimeCode = `import { perf_begin, perf_end, perf_register } from "${specifier}";\n`;
	}

	function indexToLineCol(index: number) {
		let line = 1;
		let col = 1;
		for (let i = 0; i < index && i < fc.length; i++) {
			if (fc[i] === "\n") {
				line++;
				col = 1;
			} else {
				col++;
			}
		}
		return { line, col };
	}

	let state: (Directive | Statement | Expression)[] = [];
	const registrations: string[] = [];

	function keyToName(key: any): string | undefined {
		if (!key) return undefined;
		if (typeof key.name === "string") return key.name;
		if (typeof key.value === "string") return key.value;
		if (typeof key.value === "number") return String(key.value);
		if (key.type === "PrivateIdentifier" && typeof key.name === "string") {
			return `#${key.name}`;
		}
		if (key.type === "ThisExpression") return "this";
		return undefined;
	}

	function leftToName(left: any): string | undefined {
		if (!left) return undefined;
		if (left.type === "Identifier" && typeof left.name === "string") {
			return left.name;
		}
		if (left.type === "MemberExpression") {
			const objectName =
				left.object?.type === "Identifier"
					? left.object.name
					: left.object?.type === "ThisExpression"
						? "this"
						: undefined;
			const propertyName = keyToName(left.property);
			if (objectName && propertyName) return `${objectName}.${propertyName}`;
			if (propertyName) return propertyName;
		}
		return undefined;
	}

	function calleeToName(callee: any): string | undefined {
		if (!callee) return undefined;
		if (callee.type === "Identifier" && typeof callee.name === "string") {
			return callee.name;
		}
		if (callee.type === "MemberExpression") {
			const objectName =
				callee.object?.type === "Identifier"
					? callee.object.name
					: callee.object?.type === "ThisExpression"
						? "this"
						: undefined;
			const propertyName = keyToName(callee.property);
			if (objectName && propertyName) return `${objectName}.${propertyName}`;
			if (propertyName) return propertyName;
		}
		return undefined;
	}

	function getContextName(node: any): string {
		if (typeof node?.id?.name === "string") return node.id.name;

		const parent = state.at(-2) as any;
		const grandParent = state.at(-3) as any;

		if (parent?.type === "VariableDeclarator") {
			const variableName = leftToName(parent.id);
			if (variableName) return variableName;
		}

		if (parent?.type === "Property") {
			const propertyName = keyToName(parent.key);
			if (propertyName) return propertyName;
		}

		if (parent?.type === "MethodDefinition") {
			const methodName = keyToName(parent.key);
			if (methodName) return methodName;
		}

		if (parent?.type === "AssignmentExpression") {
			const assignmentName = leftToName(parent.left);
			if (assignmentName) return assignmentName;
		}

		if (
			parent?.type === "CallExpression" ||
			parent?.type === "NewExpression"
		) {
			const calleeName = calleeToName(parent.callee);
			if (Array.isArray(parent.arguments)) {
				const argIndex = parent.arguments.indexOf(node);
				if (argIndex >= 0 && calleeName) return `${calleeName}:arg${argIndex}`;
			}
		}

		if (grandParent?.type === "VariableDeclarator") {
			const variableName = leftToName(grandParent.id);
			if (variableName) return variableName;
		}

		return "<unnamed function>";
	}

	function inject(name: string, start: number, end: number, arrow: boolean, meta: any) {
		meta.stack = state.map((e) => e.type);
		registrations.push(
			`perf_register(${start},${JSON.stringify(indexToLineCol(start))},${JSON.stringify(name)},${JSON.stringify(meta)});`,
		);
		const id = `perf$${start}`;
		if (arrow) {
			content.appendLeft(
				start,
				`{const ${id}=performance.now();perf_begin(${start},${id});try{return (`,
			);
			content.appendRight(
				end,
				`);}catch(_e){throw _e}finally{perf_end(performance.now());}}`,
			);
		} else {
			content.appendLeft(
				start + 1,
				`const ${id}=performance.now();perf_begin(${start},${id});try{`,
			);
			content.appendRight(
				end - 1,
				`}catch(_e){throw _e}finally{perf_end(performance.now());}`,
			);
		}
	}

	if (options?.appendLog !== false && sourceType === "commonjs") {
		content.append("process.on('exit',perf_log);");
	}

	if (options?.rewriteRelativeImportsToPerf) {
		rewriteModuleSpecifiers(content, fc);
	}

	if (options?.exportPerfApi && options.runtimeImportSpecifier) {
		content.append(
			`\nexport { perf_start, perf_stop } from "${options.runtimeImportSpecifier}";`,
		);
	}

	function walk(s: Directive | Statement | Expression) {
		try {
			state.push(s);
			switch (s.type) {
			case "FunctionDeclaration": {
				const start = s.body!.start;
				const end = s.body!.end;
				for (let i = 0; i < s.body!.body.length; i++) {
					walk(s.body!.body[i]);
				}
				inject(s.id?.name || "<unnamed function>", start, end, false, {
					async: s.async,
					generator: s.generator,
				});
				break;
			}
			case "FunctionExpression": {
				const start = s.body!.start;
				const end = s.body!.end;
				for (let i = 0; i < s.body!.body.length; i++) {
					walk(s.body!.body[i]);
				}
				inject(getContextName(s), start, end, false, {
					async: s.async,
					generator: s.generator,
				});
				break;
			}
			case "ArrowFunctionExpression": {
				if (s.body.type === "BlockStatement") {
					const start = s.body!.start;
					const end = s.body!.end;
					for (let i = 0; i < s.body!.body.length; i++) {
						walk(s.body!.body[i]);
					}
					inject(getContextName(s), start, end, false, {
						async: s.async,
						generator: s.generator,
						arrow: true,
					});
				} else {
					walk(s.body);
					inject(
						getContextName(s),
						s.body.start,
						s.body.end,
						true,
						{
							async: s.async,
							generator: s.generator,
							arrow: true,
						},
					);
				}
				break;
			}
			default:
				for (let key of visitorKeys[s.type]) {
					let v = (s as any)[key as any] as unknown;
					if (!v) continue;
					if (Array.isArray(v)) {
						for (const e of v) walk(e);
					} else {
						walk(v as any);
					}
				}
			}
		}
		finally {
			state.pop();
		}
	}

	for (const s of x.program.body) {
		walk(s);
	}

	const perfHeader =
		registrations.length > 0
			? `${runtimeCode}${registrations.join("\n")}\n`
			: runtimeCode;
	content.prependRight(runtimeInsertIndex, perfHeader);

	await writeFile(outputPath, content.toString());
}

async function listJsFilesRecursive(rootDir: string): Promise<string[]> {
	const result: string[] = [];
	async function walk(dir: string) {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = resolve(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(fullPath);
				continue;
			}
			if (!entry.isFile()) continue;
			if (!entry.name.endsWith(".js")) continue;
			if (entry.name.endsWith(".perf.js")) continue;
			result.push(fullPath);
		}
	}
	await walk(rootDir);
	return result;
}

async function main() {
	const inputArg = process.argv[2] ?? "dist/mcb.js";
	const outputArg = process.argv[3] ?? getDefaultOutput(inputArg);
	const inputPath = resolve(__dirname, "..", inputArg);
	const outputPath = resolve(__dirname, "..", outputArg);

	const isLibraryEntry = inputArg.replace(/\\/g, "/") === "dist/libmcb.js";

	if (isLibraryEntry) {
		const distRoot = resolve(__dirname, "..", "dist");
		const sharedRuntimePath = resolve(distRoot, SHARED_RUNTIME_FILE);
		await writeFile(sharedRuntimePath, getSharedRuntimeModuleCode());
		const files = await listJsFilesRecursive(distRoot);
		for (const filePath of files) {
			const rel = relative(distRoot, filePath).replace(/\\/g, "/");
			if (rel === "mcb.js" || rel === "testbed.js") continue;
			const ext = extname(filePath);
			const outPath = `${filePath.slice(0, -ext.length)}.perf${ext}`;
			const runtimeImportSpecifierRaw = relative(
				dirname(outPath),
				sharedRuntimePath,
			).replace(/\\/g, "/");
			const runtimeImportSpecifier = runtimeImportSpecifierRaw.startsWith(".")
				? runtimeImportSpecifierRaw
				: `./${runtimeImportSpecifierRaw}`;
			await transformFile(filePath, outPath, {
				appendLog: false,
				rewriteRelativeImportsToPerf: true,
				moduleSharedRuntime: true,
				runtimeImportSpecifier,
			});
		}
		const entryRuntimeImportRaw = relative(
			dirname(outputPath),
			sharedRuntimePath,
		).replace(/\\/g, "/");
		const entryRuntimeImportSpecifier = entryRuntimeImportRaw.startsWith(".")
			? entryRuntimeImportRaw
			: `./${entryRuntimeImportRaw}`;
		await transformFile(inputPath, outputPath, {
			appendLog: true,
			rewriteRelativeImportsToPerf: true,
			moduleSharedRuntime: true,
			runtimeImportSpecifier: entryRuntimeImportSpecifier,
			exportPerfApi: true,
		});
		return;
	}

	await transformFile(inputPath, outputPath, {
		appendLog: true,
		rewriteRelativeImportsToPerf: false,
		moduleSharedRuntime: false,
	});
}

void main();

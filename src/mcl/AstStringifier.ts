import { AstNode, JsonTagType } from "./AstNode";

export class AstStringifier {
	private segments: string[] = [];
	private indent = 0;
	private tabs: string[] = [""];

	private tab(): void {
		const existing = this.tabs[this.indent];
		if (existing !== undefined) {
			this.segments.push(existing);
			return;
		}
		let tab = this.tabs[this.tabs.length - 1] ?? "";
		for (let i = this.tabs.length - 1; i < this.indent; i++) {
			this.tabs[i] = tab;
			tab += "\t";
		}
		this.segments.push(tab);
	}

	private inc(): void {
		this.indent++;
	}

	private dec(): void {
		this.indent--;
	}

	private literal(text: string): void {
		this.segments.push(text);
	}

	private lastSegment(): string | undefined {
		if (this.segments.length === 0) {
			return undefined;
		}
		return this.segments[this.segments.length - 1];
	}

	private ensureLineBreak(indent: boolean): boolean {
		if (indent) {
			return indent;
		}
		const last = this.lastSegment();
		if (last && last.endsWith("\\")) {
			this.literal("\n");
			return true;
		}
		return indent;
	}

	private write(node: AstNode, indent = true, hideBlock = false): void {
		indent = this.ensureLineBreak(indent);
		switch (node.type) {
			case "Raw": {
				if (indent) {
					this.tab();
				}
				if (node.isMacro) {
					this.literal("$");
				}
				this.literal(node.value);
				if (node.continuations && node.continuations.length > 0) {
					throw new Error("continuations not supported");
				}
				this.literal("\n");
				break;
			}
			case "FunctionDef": {
				if (indent) {
					this.tab();
				}
				this.literal("function ");
				this.literal(node.name);
				if (node.appendTo) {
					this.literal(" ");
					this.literal(node.appendTo);
				}
				this.literal("{\n");
				this.inc();
				for (const child of node.body) {
					this.write(child);
				}
				this.dec();
				this.tab();
				this.literal("}\n");
				break;
			}
			case "TemplateDef": {
				throw new Error("template def not supported");
			}
			case "Directory": {
				if (indent) {
					this.tab();
				}
				this.literal("dir ");
				this.literal(node.name);
				this.literal("{\n");
				this.inc();
				for (const child of node.body) {
					this.write(child);
				}
				this.dec();
				this.tab();
				this.literal("}\n");
				break;
			}
			case "Import": {
				if (indent) {
					this.tab();
				}
				this.literal("import ");
				this.literal(node.name);
				this.literal("\n");
				break;
			}
			case "CompileTimeLoop": {
				if (indent) {
					this.tab();
				}
				const asPart = node.as ? node.as.join(",") : "";
				this.literal(`REPEAT(${node.expression}) as ${asPart} {`);
				this.inc();
				for (const child of node.body) {
					this.write(child);
				}
				this.dec();
				this.literal("}\n");
				break;
			}
			case "CompileTimeIf": {
				if (indent) {
					this.tab();
				}
				this.literal(`IF(${node.expression}) {`);
				this.inc();
				for (const child of node.body) {
					this.write(child);
				}
				this.dec();
				this.tab();
				this.literal("}");
				for (const elseExpression of node.elseExpressions) {
					this.literal(
						` ELSE ${elseExpression.condition == null ? `IF(${elseExpression.condition})` : ""} {`,
					);
					this.inc();
					for (const child of elseExpression.node) {
						this.write(child);
					}
					this.dec();
					this.tab();
					this.literal("}");
				}
				this.literal("\n");
				break;
			}
			case "MultiLineScript": {
				throw new Error("multi line script not supported");
			}
			case "Block": {
				if (indent) {
					this.tab();
				}
				if (node.isMacro && !hideBlock) {
					this.literal("$");
				}
				if (!hideBlock) {
					this.literal("block");
				}
				if (node.name && node.name !== "") {
					this.literal(" ");
					this.literal(node.name);
					this.literal(" ");
				}
				const data = node.data ? ` ${node.data}` : "";
				this.literal(`{${data}\n`);
				this.inc();
				for (const child of node.body) {
					this.write(child);
				}
				this.dec();
				this.tab();
				this.literal("}");
				if (indent) {
					this.literal("\n");
				}
				break;
			}
			case "TickBlock": {
				if (indent) {
					this.tab();
				}
				this.literal("tick {\n");
				this.inc();
				for (const child of node.body) {
					this.write(child);
				}
				this.dec();
				this.tab();
				this.literal("}\n");
				break;
			}
			case "LoadBlock": {
				if (indent) {
					this.tab();
				}
				this.literal("load {\n");
				this.inc();
				for (const child of node.body) {
					this.write(child);
				}
				this.dec();
				this.tab();
				this.literal("}\n");
				break;
			}
			case "ExecuteBlock": {
				if (indent) {
					this.tab();
				}
				if (node.isMacro) {
					this.literal("$");
				}
				this.literal(node.execute);
				this.literal(` {${node.data ? ` ${node.data}` : ""}\n`);
				this.inc();
				for (const child of node.body) {
					this.write(child);
				}
				this.dec();
				this.tab();
				this.literal("}");
				const continuations = node.continuations ?? [];
				for (const continuation of continuations) {
					if (
						continuation.type === "Block" &&
						(!continuation.name || continuation.name === "")
					) {
						const macroPrefix = continuation.isMacro ? "$" : "";
						this.literal(` else ${macroPrefix}run `);
						this.write(continuation, false, true);
					} else {
						this.literal(" else ");
						this.write(continuation, false, true);
					}
				}
				if (indent) {
					this.literal("\n");
				}
				break;
			}
			case "ScheduleBlock": {
				if (indent) {
					this.tab();
				}
				if (node.isMacro) {
					this.literal("$");
				}
				this.literal("schedule ");
				this.literal(node.delay);
				this.literal(" ");
				this.literal(node.blockType);
				this.literal(" {\n");
				this.inc();
				for (const child of node.body) {
					this.write(child);
				}
				this.dec();
				this.tab();
				this.literal("}\n");
				break;
			}
			case "Comment": {
				if (indent) {
					this.tab();
				}
				this.literal("# ");
				this.literal(node.value);
				this.literal("\n");
				break;
			}
			case "JsonFile": {
				this.tab();
				this.writeJson(node.name, node.info);
				break;
			}
			case "ClockExpr": {
				if (indent) {
					this.tab();
				}
				this.literal("clock ");
				this.literal(node.name);
				this.literal(" ");
				this.literal(node.time);
				this.literal(" {\n");
				this.inc();
				for (const child of node.body) {
					this.write(child);
				}
				this.dec();
				this.tab();
				this.literal("}\n");
				break;
			}
			case "Execute": {
				if (indent) {
					this.tab();
				}
				if (node.isMacro) {
					this.literal("$");
				}
				this.literal(node.command);
				this.literal(" ");
				this.write(node.value, false);
				this.literal("\n");
				break;
			}
			case "FunctionCall": {
				if (indent) {
					this.tab();
				}
				if (node.isMacro) {
					this.literal("$");
				}
				this.literal("function ");
				this.literal(node.name);
				if (node.data) {
					this.literal(" ");
					this.literal(node.data);
				}
				this.literal("\n");
				break;
			}
			case "EqCommand": {
				if (indent) {
					this.tab();
				}
				this.literal(`eq ${node.command}`);
				this.literal("\n");
				break;
			}
			case "ScheduleCall": {
				if (indent) {
					this.tab();
				}
				if (node.isMacro) {
					this.literal("$");
				}
				this.literal("schedule function ");
				this.literal(node.target);
				this.literal(" ");
				this.literal(node.delay);
				this.literal(" ");
				this.literal(node.mode);
				this.literal("\n");
				break;
			}
			case "ReturnRun": {
				if (indent) {
					this.tab();
				}
				if (node.isMacro) {
					this.literal("$");
				}
				this.literal("return run ");
				this.inc();
				this.write(node.value, false, true);
				this.dec();
				this.literal("\n");
				break;
			}
			case "ScheduleClear": {
				if (indent) {
					this.tab();
				}
				if (node.isMacro) {
					this.literal("$");
				}
				this.literal("schedule clear ");
				this.literal(node.target);
				this.literal("\n");
				break;
			}
			case "Void": {
				break;
			}
			case "Group": {
				let isInline = indent === false;
				for (const child of node.body) {
					if (!indent && !isInline) {
						throw new Error(
							"Group should not have multiple children if the location is inline",
						);
					}
					this.write(child, indent);
					isInline = false;
				}
				break;
			}
			default:
				throw new Error(`unknown node type: ${JSON.stringify(node)}`);
		}
	}

	private writeJson(name: string, info: JsonTagType): void {
		switch (info.kind) {
			case "Tag": {
				this.literal("tag ");
				this.literal(info.subType);
				this.literal(" ");
				this.literal(name);
				if (info.replace) {
					this.literal(" replace");
				}
				this.literal(" {\n");
				this.inc();
				for (const entry of info.entries) {
					this.write(entry);
				}
				this.dec();
				this.tab();
				this.literal("}\n");
				break;
			}
			case "WorldGen": {
				this.literal("worldgen ");
				this.literal(info.name);
				this.literal(" {\n");
				this.inc();
				for (const entry of info.entries) {
					this.write(entry);
				}
				this.dec();
				this.tab();
				this.literal("}\n");
				break;
			}
			default: {
				this.literal(String(info));
			}
		}
	}

	private toString(node: AstNode): string {
		this.write(node);
		return this.segments.join("");
	}

	static stringify(node: AstNode): string {
		return new AstStringifier().toString(node);
	}
}

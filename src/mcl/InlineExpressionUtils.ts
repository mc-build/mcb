import { PosInfo } from "./Tokenizer";

export function advancePos(pos: PosInfo, text: string): PosInfo {
	let line = pos.line;
	let col = pos.col;
	for (const ch of text) {
		if (ch === "\n") {
			line++;
			col = 0;
		} else {
			col++;
		}
	}
	return { file: pos.file, line, col };
}

/**
 * Splits `target` on `<%...%>` markers and replaces each one with the result
 * of `evaluate`, called with that specific marker's own position (not the
 * position of the whole string) so callers can attribute errors to the
 * exact expression that failed.
 */
export function injectExpressions(
	target: string,
	pos: PosInfo,
	evaluate: (expr: string, pos: PosInfo) => unknown,
): string {
	const parts = target.split(/(<%[\s\S]*?%>)/g);
	const output: string[] = [];
	let partPos = pos;

	for (const part of parts) {
		if (!part) {
			continue;
		}
		if (part.startsWith("<%") && part.endsWith("%>")) {
			const expr = part.slice(2, -2);
			const result = evaluate(expr, partPos);
			output.push(result == null ? "" : String(result));
		} else {
			output.push(part);
		}
		partPos = advancePos(partPos, part);
	}

	return output.join("");
}

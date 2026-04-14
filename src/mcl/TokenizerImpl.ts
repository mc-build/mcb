import { Token, PosInfo } from "./Tokenizer";

export class Tokenizer {
	static tokenize(code: string, file: string): Token[] {
		let isInMultilineComment = false;
		const indents: number[] = [];
		const lines = code.split("\n").map((rawLine) => {
			let line = rawLine;
			let indent = 0;
			while (line.charAt(0) === " " || line.charAt(0) === "\t") {
				line = line.substring(1);
				indent++;
			}
			indents.push(indent);
			return line;
		});

		const result: Token[] = [];
		let lineNum = 0;
		let colNum = 0;
		let lineIdx = 0;

		while (lineIdx < lines.length) {
			let line = lines[lineIdx];
			const indent = indents[lineNum];

			while (true) {
				while (
					line.length > 0 &&
					(line.charAt(line.length - 1) === "\n" ||
						line.charAt(line.length - 1) === "\r")
				) {
					line = line.substring(0, line.length - 1);
				}
				const endTrimmed = line.trimEnd();
				if (endTrimmed.endsWith("\\")) {
					line = endTrimmed;
					const base = line.substring(0, line.length - 1);
					const nextLine = lines[lineIdx + 1];
					if (nextLine === undefined) {
						line = base;
						break;
					}
					line = `${base}${nextLine.trim()}`;
					lineIdx++;
					lineNum++;
				} else {
					break;
				}
			}

			lineIdx++;
			lineNum++;

			if (line === "###") {
				isInMultilineComment = !isInMultilineComment;
				continue;
			}

			const basePos: PosInfo = { line: lineNum, col: colNum + indent, file };

			if (isInMultilineComment) {
				result.push({ type: "Literal", v: `### ${line}`, pos: basePos });
				continue;
			}

			if (line.length > 0 && line.charAt(0) === "#") {
				result.push({ type: "Literal", v: line, pos: basePos });
				continue;
			}

			if (line.length > 0 && line.charAt(0) === "}") {
				result.push({ type: "BracketClose", pos: basePos });
				line = line.substring(1);
			}

			let i = 0;
			const braces: string[] = [];
			let matchedOpeningBrace = false;

			while (i < line.length) {
				const idx = line.length - i - 1;
				const ch = line.charAt(idx);

				if (ch === "}") {
					braces.push("curly");
				} else if (ch === "{") {
					if (braces.length === 0) {
						const content = line.substring(0, idx).trim();
						if (content.length > 0) {
							result.push({ type: "Literal", v: content, pos: basePos });
						}
						const dataRaw = line.substring(idx + 1).trim();
						result.push({
							type: "BracketOpen",
							pos: { line: lineNum, col: colNum + indent + idx, file },
							data: dataRaw.length > 0 ? dataRaw : undefined,
						});
						matchedOpeningBrace = true;
						break;
					}
					braces.pop();
				}

				i++;
			}

			const trimmed = line.trim();
			if (matchedOpeningBrace || trimmed.length === 0) {
				continue;
			}

			result.push({ type: "Literal", v: trimmed, pos: basePos });
		}

		return result;
	}
}

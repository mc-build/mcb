package mcl;

import haxe.Json;
import MinificationHelper.Minified;

typedef PosInfo = {
	line:Int,
	col:Int,
	file:String
}

enum Token {
	Literal(v:String, pos:PosInfo);
	BracketOpen(pos:PosInfo, data:Null<String>);
	BracketClose(pos:PosInfo);
}

enum abstract TokenIds(Int) from Int to Int {
	var Literal = 0;
	var BracketOpen = 1;
	var BracketClose = 2;
}

enum Brackets {
	Curly;
	Square;
	Round;
}

@:expose
class Tokenizer {
	public static function tokenize(code:String, file:String):Array<Token> {
		var isInMultilineComment = false;
		var indents:Array<Int> = [];
		var lines:Array<String> = [
			for (line in code.split("\n")) {
				var indent = 0;
				while (switch (line.charAt(0)) {
						case " " | "\t":
							line = line.substring(1);
							indent++;
							true;
						default:
							false;
					}) {}
				indents.push(indent);
				line;
			}
		];

		var result:Array<Token> = [];

		var lineNum = 0;
		var colNum = 0;
		var lineIdx = 0;
		while (lineIdx < lines.length) {
			var line = lines[lineIdx];
			var indent = indents[lineNum];
			var internalLineNum = 0;
			while (true) {
				while (line.charAt(line.length - 1) == "\n" || line.charAt(line.length - 1) == "\r") {
					line = line.substring(0, line.length - 1);
				}
				if (StringTools.endsWith(line, "\\")) {
					line += "\n\t" + lines[++lineIdx];
					lineNum++;
				} else {
					break;
				}
			}
			lineIdx++;
			lineNum++;
			if (line == "###") {
				isInMultilineComment = !isInMultilineComment;
				continue;
			}
			if (isInMultilineComment) {
				result.push(Literal("### " + line, {line: lineNum, col: colNum + indent, file: file}));
				continue;
			}
			if (line.charAt(0) == "#") {
				result.push(Literal(line, {line: lineNum, col: colNum + indent, file: file}));
				continue;
			}
			if (line.charAt(0) == "}") {
				result.push(BracketClose({line: lineNum, col: colNum + indent, file: file}));
				line = line.substring(1);
			}
			var i = 0;
			var braces:Array<Brackets> = [];
			var done = false;
			while (i < line.length) {
				var idx = line.length - i - 1;
				var c = line.charAt(idx);

				if (c == "}") {
					braces.push(Brackets.Curly);
				} else if (c == "{") {
					if (braces.length == 0) {
						var content = StringTools.trim(line.substring(0, idx));
						if (content.length > 0)
							result.push(Literal(content, {line: lineNum, col: colNum + indent, file: file}));
						result.push(BracketOpen({line: lineNum, col: colNum + indent + idx, file: file}, StringTools.trim(line.substring(idx + 1))));
						done = true;
						break;
					}
					braces.pop();
				}
				i++;
			}
			var trimmed = StringTools.trim(line);
			if (done || trimmed.length == 0)
				continue;
			result.push(Literal(StringTools.trim(trimmed), {line: lineNum, col: colNum + indent, file: file}));
		}
		return result;
	};
}

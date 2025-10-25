import type { CompilerContext } from "./Compiler";
import { CompilerError } from "./error/CompilerError";

export type McMathCompileResult = {
	commands: string;
	constants: number[];
};

type ExpressionNode =
	| { type: "Literal"; value: number }
	| { type: "Identifier"; name: string }
	| { type: "Unary"; operator: string; operand: ExpressionNode }
	| {
			type: "Binary";
			operator: string;
			left: ExpressionNode;
			right: ExpressionNode;
	  }
	| { type: "Call"; callee: string; args: ExpressionNode[] }
	| {
			type: "Conditional";
			test: ExpressionNode;
			consequent: ExpressionNode;
			alternate: ExpressionNode;
	  };

type FlattenedNode =
	| { kind: "Literal"; value: number }
	| { kind: "Identifier"; name: string }
	| { kind: "Unary"; operator: string; operand: FlattenedNode }
	| {
			kind: "Binary";
			operator: string;
			left: FlattenedNode;
			right: FlattenedNode;
	  }
	| { kind: "Add"; items: FlattenedNode[] }
	| { kind: "Mul"; items: FlattenedNode[] }
	| { kind: "Call"; callee: string; args: FlattenedNode[] }
	| {
			kind: "Conditional";
			test: FlattenedNode;
			consequent: FlattenedNode;
			alternate: FlattenedNode;
	  };

type Token =
	| { type: "number"; value: number; index: number }
	| { type: "identifier"; value: string; index: number }
	| { type: "operator"; value: string; index: number }
	| { type: "paren"; value: "(" | ")"; index: number };

const OPERATORS = new Set(["+", "-", "*", "/", "%"]);

const SCOREBOARD_SEPARATORS = new Set(["=", "+=", "-=", "*=", "/=", "%="]);

function isIdentifierStart(char: string): boolean {
	const code = char.charCodeAt(0);
	return (
		(code >= 65 && code <= 90) ||
		(code >= 97 && code <= 122) ||
		char === "_" ||
		char === "$" ||
		char === "@" ||
		char === "#"
	);
}

function isIdentifierPart(char: string): boolean {
	const code = char.charCodeAt(0);
	return isIdentifierStart(char) || (code >= 48 && code <= 57) || char === ".";
}

function tokenizeExpression(
	expression: string,
	context: CompilerContext,
): Token[] {
	const tokens: Token[] = [];
	let index = 0;

	const throwError = (message: string, at: number) => {
		throw CompilerError.create(`${message} at column ${at + 1}`, null, context);
	};

	while (index < expression.length) {
		const char = expression.charAt(index);

		if (char === " " || char === "\t" || char === "\n" || char === "\r") {
			index++;
			continue;
		}

		if (OPERATORS.has(char)) {
			tokens.push({ type: "operator", value: char, index });
			index++;
			continue;
		}

		if (char === "(" || char === ")") {
			tokens.push({ type: "paren", value: char, index });
			index++;
			continue;
		}

		if (char >= "0" && char <= "9") {
			let value = char;
			let cursor = index + 1;
			while (cursor < expression.length) {
				const digit = expression.charAt(cursor);
				if (digit >= "0" && digit <= "9") {
					value += digit;
					cursor++;
					continue;
				}
				if (digit === ".") {
					throwError(
						"Decimal literals are not supported in eq expressions",
						cursor,
					);
				}
				break;
			}
			tokens.push({ type: "number", value: Number.parseInt(value, 10), index });
			index = cursor;
			continue;
		}

		if (isIdentifierStart(char)) {
			let value = char;
			let cursor = index + 1;
			while (
				cursor < expression.length &&
				isIdentifierPart(expression.charAt(cursor))
			) {
				value += expression.charAt(cursor);
				cursor++;
			}
			tokens.push({ type: "identifier", value, index });
			index = cursor;
			continue;
		}

		throwError(`Unexpected character '${char}' in eq expression`, index);
	}

	return tokens;
}

function parseNormalizedExpression(
	expression: string,
	context: CompilerContext,
): ExpressionNode {
	const tokens = tokenizeExpression(expression, context);
	let position = 0;

	const peek = () => tokens[position] ?? null;
	const consume = () => tokens[position++] ?? null;

	const unexpected = (token: Token | null): never => {
		if (!token) {
			throw CompilerError.create(
				"Unexpected end of eq expression",
				null,
				context,
			);
		}
		throw CompilerError.create(
			`Unexpected token '${token.value}' in eq expression`,
			null,
			context,
		);
	};

	const parsePrimary = (): ExpressionNode => {
		const token = peek();
		if (!token) {
			throw CompilerError.create(
				"Unexpected end of eq expression",
				null,
				context,
			);
		}

		if (token.type === "number") {
			consume();
			return { type: "Literal", value: token.value };
		}

		if (token.type === "identifier") {
			consume();
			const next = peek();
			if (next && next.type === "paren" && next.value === "(") {
				throw CompilerError.create(
					"Function calls are not supported in eq expressions",
					null,
					context,
				);
			}
			return { type: "Identifier", name: token.value };
		}

		if (
			token.type === "operator" &&
			(token.value === "-" || token.value === "+")
		) {
			consume();
			const operand = parsePrimary();
			if (token.value === "+") {
				return operand;
			}
			return { type: "Unary", operator: "-", operand };
		}

		if (token.type === "paren" && token.value === "(") {
			consume();
			const expressionNode = parseAddSub();
			const closing = consume();
			if (!closing || closing.type !== "paren" || closing.value !== ")") {
				throw CompilerError.create(
					"Unmatched '(' in eq expression",
					null,
					context,
				);
			}
			return expressionNode;
		}

		return unexpected(token);
	};

	const parseMulDiv = (): ExpressionNode => {
		let node = parsePrimary();
		while (true) {
			const token = peek();
			if (
				!token ||
				token.type !== "operator" ||
				(token.value !== "*" && token.value !== "/" && token.value !== "%")
			) {
				break;
			}
			consume();
			const right = parsePrimary();
			node = { type: "Binary", operator: token.value, left: node, right };
		}
		return node;
	};

	const parseAddSub = (): ExpressionNode => {
		let node = parseMulDiv();
		while (true) {
			const token = peek();
			if (
				!token ||
				token.type !== "operator" ||
				(token.value !== "+" && token.value !== "-")
			) {
				break;
			}
			consume();
			const right = parseMulDiv();
			node = { type: "Binary", operator: token.value, left: node, right };
		}
		return node;
	};

	const root = parseAddSub();
	if (position < tokens.length) {
		unexpected(peek());
	}
	return root;
}

export function compile(
	equation: string,
	context: CompilerContext,
): McMathCompileResult {
	validateSelectors(equation, context);

	let working = equation;
	const skip = () => {
		let offset = 0;
		while (offset < working.length && working.charAt(offset) === " ") {
			offset++;
		}
		working = working.substring(offset);
	};
	const collect = () => {
		let offset = 0;
		while (offset < working.length && working.charAt(offset) !== " ") {
			offset++;
		}
		const token = working.substring(0, offset);
		working = working.substring(offset);
		return token;
	};

	skip();
	const lhsTarget = collect();
	if (!lhsTarget) {
		throw CompilerError.create(
			"eq command is missing a scoreboard target",
			null,
			context,
		);
	}
	skip();
	const lhsObjective = collect();
	if (!lhsObjective) {
		throw CompilerError.create(
			"eq command is missing a scoreboard objective",
			null,
			context,
		);
	}
	skip();
	const separator = collect();
	if (!separator) {
		throw CompilerError.create(
			"eq command is missing an operator",
			null,
			context,
		);
	}
	if (!SCOREBOARD_SEPARATORS.has(separator)) {
		throw CompilerError.create(
			`Unsupported eq operator '${separator}'`,
			null,
			context,
		);
	}
	skip();
	const rhs = working;
	if (rhs.length === 0) {
		throw CompilerError.create(
			"eq command is missing a right-hand side expression",
			null,
			context,
		);
	}

	const { normalizedEquation, placeholderToScoreboard } = normalizeEquation(
		rhs,
		context,
	);

	let expressionNode: ExpressionNode;
	try {
		expressionNode = parseNormalizedExpression(normalizedEquation, context);
	} catch (error) {
		if (error instanceof CompilerError) {
			throw error;
		}
		throw CompilerError.create(
			`Failed to parse eq expression '${normalizedEquation}': ${String(error)}`,
			null,
			context,
		);
	}

	const organized = organize(expressionNode);
	const flattened = flatten(organized);
	const lhs = `${lhsTarget} ${lhsObjective}`;
	try {
		return render(flattened, lhs, placeholderToScoreboard, separator, context);
	} catch (error) {
		if (error instanceof CompilerError) {
			throw error;
		}
		throw CompilerError.create(
			`Failed to compile eq expression: ${String(error)}`,
			null,
			context,
		);
	}
}

function validateSelectors(equation: string, context: CompilerContext): void {
	for (let i = 0; i < equation.length; i++) {
		if (equation.charAt(i) === "@") {
			const next = equation.charAt(i + 1);
			const following = equation.charAt(i + 2);
			if (next !== "s" && following !== "[") {
				throw CompilerError.create(
					"Only unrestricted @s selectors are allowed in eq expressions to avoid unexpected behaviour.",
					null,
					context,
				);
			}
		}
	}
}

function normalizeEquation(
	rhs: string,
	context: CompilerContext,
): {
	normalizedEquation: string;
	placeholderToScoreboard: Map<string, string>;
} {
	const scoreboardToPlaceholder = new Map<string, string>();
	const placeholderToScoreboard = new Map<string, string>();
	let nextVarId = 0;

	const getNextPlaceholder = () => {
		nextVarId += 1;
		return `var${nextVarId}`;
	};

	const isAlphaNumeric = (char: string) => {
		const code = char.charCodeAt(0);
		return (
			(code >= 97 && code <= 122) || // a-z
			(code >= 65 && code <= 90) || // A-Z
			(code >= 48 && code <= 57) || // 0-9
			char === "." ||
			char === "_" ||
			char === "$" ||
			char === "#" ||
			char === "@"
		);
	};

	let idx = 0;
	let normalized = "";
	while (idx < rhs.length) {
		const char = rhs.charAt(idx);
		const code = char.charCodeAt(0);
		const isStart =
			isAlphaNumeric(char);

		if (isStart) {
			let first = "";
			while (idx < rhs.length && isAlphaNumeric(rhs.charAt(idx))) {
				first += rhs.charAt(idx);
				idx++;
			}

			if (idx >= rhs.length || rhs.charAt(idx) !== " ") {
				if (/^[0-9]+$/.test(first)) {
					normalized += first;
					continue;
				}
				throw CompilerError.create(
					"Scoreboard entries must contain a space between name and objective",
					null,
					context,
				);
			}
			idx++;

			let second = "";
			while (idx < rhs.length && isAlphaNumeric(rhs.charAt(idx))) {
				second += rhs.charAt(idx);
				idx++;
			}

			if (second.length === 0) {
				if (/^[0-9]+$/.test(first)) {
					normalized += first;
					continue;
				}
				throw CompilerError.create(
					"Malformed scoreboard reference in eq expression",
					null,
					context,
				);
			}

			const scoreboard = `${first} ${second}`;
			let placeholder = scoreboardToPlaceholder.get(scoreboard);
			if (!placeholder) {
				placeholder = getNextPlaceholder();
				scoreboardToPlaceholder.set(scoreboard, placeholder);
				placeholderToScoreboard.set(placeholder, scoreboard);
			}
			normalized += placeholder;
			continue;
		}

		normalized += char;
		idx++;
	}

	return { normalizedEquation: normalized, placeholderToScoreboard };
}

function organize(node: ExpressionNode): ExpressionNode {
	switch (node.type) {
		case "Literal":
			return { ...node };
		case "Identifier":
			return { ...node };
		case "Unary":
			return {
				type: "Unary",
				operator: node.operator,
				operand: organize(node.operand),
			};
		case "Binary": {
			const left = node.left;
			const right = node.right;
			const organizedRight = organize(right);
			const organizedLeft = organize(left);

			if (left.type === "Literal" && Number.isInteger(left.value)) {
				const intValue = Math.trunc(left.value);
				switch (node.operator) {
					case "+":
						return {
							type: "Binary",
							operator: "+",
							left: organizedRight,
							right: { type: "Literal", value: intValue },
						};
					case "-":
						return {
							type: "Binary",
							operator: "+",
							left: organizedRight,
							right: { type: "Literal", value: -intValue },
						};
					case "*":
						return {
							type: "Binary",
							operator: "*",
							left: organizedRight,
							right: { type: "Literal", value: intValue },
						};
					default:
						return {
							type: "Binary",
							operator: node.operator,
							left: organizedLeft,
							right: organizedRight,
						};
				}
			}

			if (
				node.operator === "-" &&
				right.type === "Literal" &&
				Number.isInteger(right.value)
			) {
				return {
					type: "Binary",
					operator: "+",
					left: organizedLeft,
					right: { type: "Literal", value: -Math.trunc(right.value) },
				};
			}

			return {
				type: "Binary",
				operator: node.operator,
				left: organizedLeft,
				right: organizedRight,
			};
		}
		case "Call":
			return {
				type: "Call",
				callee: node.callee,
				args: node.args.map(organize),
			};
		case "Conditional":
			return {
				type: "Conditional",
				test: organize(node.test),
				consequent: organize(node.consequent),
				alternate: organize(node.alternate),
			};
		default:
			return node;
	}
}

function flatten(node: ExpressionNode): FlattenedNode {
	switch (node.type) {
		case "Literal":
			return { kind: "Literal", value: node.value };
		case "Identifier":
			return { kind: "Identifier", name: node.name };
		case "Unary":
			return {
				kind: "Unary",
				operator: node.operator,
				operand: flatten(node.operand),
			};
		case "Binary":
			if (node.operator === "+") {
				const entries: FlattenedNode[] = [];
				let literalSum = 0;
				const flushLiteral = () => {
					if (literalSum !== 0) {
						entries.push({ kind: "Literal", value: literalSum });
						literalSum = 0;
					}
				};
				const flattenAdd = (expr: ExpressionNode) => {
					if (expr.type === "Binary" && expr.operator === "+") {
						flattenAdd(expr.left);
						flattenAdd(expr.right);
					} else if (expr.type === "Literal" && Number.isInteger(expr.value)) {
						literalSum += Math.trunc(expr.value);
					} else {
						flushLiteral();
						entries.push(flatten(expr));
					}
				};
				flattenAdd(node.left);
				flattenAdd(node.right);
				flushLiteral();
				if (entries.length === 0) {
					return { kind: "Literal", value: 0 };
				}
				if (entries.length === 1) {
					return entries[0];
				}
				return { kind: "Add", items: entries };
			}
			if (node.operator === "*") {
				const entries: FlattenedNode[] = [];
				let literalProduct = 1;
				let hasLiteralProduct = false;
				let zeroDetected = false;
				const flushLiteral = () => {
					if (!hasLiteralProduct) {
						return;
					}
					if (literalProduct !== 1 || entries.length === 0) {
						entries.push({ kind: "Literal", value: literalProduct });
					}
					literalProduct = 1;
					hasLiteralProduct = false;
				};
				const flattenMul = (expr: ExpressionNode) => {
					if (zeroDetected) {
						return;
					}
					if (expr.type === "Binary" && expr.operator === "*") {
						flattenMul(expr.left);
						flattenMul(expr.right);
					} else if (expr.type === "Literal" && Number.isInteger(expr.value)) {
						const value = Math.trunc(expr.value);
						if (value === 0) {
							zeroDetected = true;
							return;
						}
						literalProduct *= value;
						hasLiteralProduct = true;
					} else {
						flushLiteral();
						entries.push(flatten(expr));
					}
				};
				flattenMul(node.left);
				flattenMul(node.right);
				if (zeroDetected) {
					return { kind: "Literal", value: 0 };
				}
				flushLiteral();
				if (entries.length === 0) {
					return { kind: "Literal", value: literalProduct }; // only literal factors
				}
				if (entries.length === 1) {
					return entries[0];
				}
				return { kind: "Mul", items: entries };
			}
			return {
				kind: "Binary",
				operator: node.operator,
				left: flatten(node.left),
				right: flatten(node.right),
			};
		case "Call":
			return {
				kind: "Call",
				callee: node.callee,
				args: node.args.map(flatten),
			};
		case "Conditional":
			return {
				kind: "Conditional",
				test: flatten(node.test),
				consequent: flatten(node.consequent),
				alternate: flatten(node.alternate),
			};
		default:
			throw new Error("Unsupported expression node during flatten");
	}
}

function render(
	root: FlattenedNode,
	result: string,
	placeholderToScoreboard: Map<string, string>,
	finalOp: string,
	context: CompilerContext,
): McMathCompileResult {
	const commands: string[] = [];
	let tempIndex = 0;
	const freeTempIds: string[] = [];
	const unsafe = new Set<string>();
	const constantUsage = new Map<number, number>();

	const constObjective = context.compiler.config.eqConstScoreboardName;
	const tempObjective = context.compiler.config.eqVarScoreboardName;

	for (const scoreboard of placeholderToScoreboard.values()) {
		unsafe.add(scoreboard);
	}

	const adjustConstantUsage = (value: number, remove = false) => {
		const current = constantUsage.get(value) ?? 0;
		if (remove) {
			if (current <= 1) {
				constantUsage.delete(value);
			} else {
				constantUsage.set(value, current - 1);
			}
		} else {
			constantUsage.set(value, current + 1);
		}
	};

	const isConstant = (
		node: FlattenedNode,
	): node is { kind: "Literal"; value: number } => node.kind === "Literal";
	const isVariable = (
		node: FlattenedNode,
	): node is { kind: "Identifier"; name: string } => node.kind === "Identifier";

	const getValue = (node: FlattenedNode): number => {
		if (!isConstant(node)) {
			throw new Error("Expected constant literal in eq expression");
		}
		if (!Number.isInteger(node.value)) {
			throw new Error("Only integer literals are supported in eq expressions");
		}
		return Math.trunc(node.value);
	};

	type RenderValue = { target: string; temporary: boolean };

	const permanent = (target: string): RenderValue => ({
		target,
		temporary: false,
	});
	const temporaryValue = (target: string): RenderValue => ({
		target,
		temporary: true,
	});

	const release = (value: RenderValue) => {
		if (!value.temporary) {
			return;
		}
		const space = value.target.indexOf(" ");
		const id = space === -1 ? value.target : value.target.substring(0, space);
		freeTempIds.push(id);
	};

	const acquireTempTarget = (): string => {
		const id = freeTempIds.pop() ?? `tmp${tempIndex++}`;
		return `${id} ${tempObjective}`;
	};

	const getVariableValue = (node: FlattenedNode): RenderValue => {
		if (!isVariable(node)) {
			throw new Error("Expected identifier in eq expression");
		}
		const scoreboard = placeholderToScoreboard.get(node.name);
		if (!scoreboard) {
			throw new Error(
				`Unknown scoreboard placeholder '${node.name}' in eq expression`,
			);
		}
		return permanent(scoreboard);
	};

	const getConstantValue = (node: FlattenedNode): RenderValue => {
		const value = getValue(node);
		adjustConstantUsage(value);
		return permanent(`${value} ${constObjective}`);
	};

	const isSafeToModify = (scoreboard: string): boolean => {
		if (unsafe.has(scoreboard)) {
			return false;
		}
		return !scoreboard.endsWith(` ${constObjective}`);
	};

	const cloneInto = (destination: string, source: RenderValue) => {
		if (source.target.endsWith(` ${constObjective}`)) {
			const space = source.target.lastIndexOf(" ");
			const literal = Number.parseInt(source.target.substring(0, space), 10);
			if (Number.isNaN(literal)) {
				throw new Error("Invalid constant scoreboard value");
			}
			adjustConstantUsage(literal, true);
			commands.push(`scoreboard players set ${destination} ${literal}`);
		} else {
			commands.push(
				`scoreboard players operation ${destination} = ${source.target}`,
			);
		}
	};

	const makeTemp = (
		source: RenderValue,
		preferredTarget: string | null = null,
	): RenderValue => {
		if (preferredTarget && isSafeToModify(preferredTarget)) {
			cloneInto(preferredTarget, source);
			return permanent(preferredTarget);
		}
		const target = acquireTempTarget();
		cloneInto(target, source);
		return temporaryValue(target);
	};

	const ensureSafe = (
		value: RenderValue,
		preferredTarget: string | null,
	): RenderValue => {
		if (isSafeToModify(value.target)) {
			return value;
		}
		const relocated = makeTemp(value, preferredTarget);
		release(value);
		return relocated;
	};

	const renderNode = (
		node: FlattenedNode,
		preferredTarget: string | null,
	): RenderValue => {
		switch (node.kind) {
			case "Unary": {
				const operand = node.operand;
				const operandValue = isVariable(operand)
					? getVariableValue(operand)
					: isConstant(operand)
						? getConstantValue(operand)
						: renderNode(operand, preferredTarget);
				const mutable = ensureSafe(operandValue, preferredTarget);
				if (node.operator === "-") {
					adjustConstantUsage(-1);
					commands.push(
						`scoreboard players operation ${mutable.target} *= -1 ${constObjective}`,
					);
				} else if (node.operator !== "+") {
					throw new Error(
						`Unsupported unary operator '${node.operator}' in eq expression`,
					);
				}
				return mutable;
			}
			case "Binary": {
				const leftValue = isVariable(node.left)
					? getVariableValue(node.left)
					: isConstant(node.left)
						? getConstantValue(node.left)
						: renderNode(node.left, preferredTarget);
				const mutableLeft = ensureSafe(leftValue, preferredTarget);
				const rightValue = isVariable(node.right)
					? getVariableValue(node.right)
					: isConstant(node.right)
						? getConstantValue(node.right)
						: renderNode(node.right, null);
				commands.push(
					`scoreboard players operation ${mutableLeft.target} ${node.operator}= ${rightValue.target}`,
				);
				release(rightValue);
				return mutableLeft;
			}
			case "Add": {
				if (node.items.length === 0) {
					throw new Error("Malformed addition in eq expression");
				}
				const first = node.items[0];
				let accumulator = isVariable(first)
					? getVariableValue(first)
					: isConstant(first)
						? getConstantValue(first)
						: renderNode(first, preferredTarget);
				accumulator = ensureSafe(accumulator, preferredTarget);

				for (let index = 1; index < node.items.length; index++) {
					const entry = node.items[index];
					if (isVariable(entry)) {
						commands.push(
							`scoreboard players operation ${accumulator.target} += ${getVariableValue(entry).target}`,
						);
					} else if (isConstant(entry)) {
						const value = getValue(entry);
						if (value > 0) {
							commands.push(
								`scoreboard players add ${accumulator.target} ${value}`,
							);
						} else if (value < 0) {
							commands.push(
								`scoreboard players remove ${accumulator.target} ${-value}`,
							);
						}
					} else {
						const valueResult = renderNode(entry, null);
						commands.push(
							`scoreboard players operation ${accumulator.target} += ${valueResult.target}`,
						);
						release(valueResult);
					}
				}
				return accumulator;
			}
			case "Mul": {
				if (node.items.length === 0) {
					throw new Error("Malformed multiplication in eq expression");
				}
				const first = node.items[0];
				let accumulator = isVariable(first)
					? getVariableValue(first)
					: isConstant(first)
						? getConstantValue(first)
						: renderNode(first, preferredTarget);
				accumulator = ensureSafe(accumulator, preferredTarget);

				for (let index = 1; index < node.items.length; index++) {
					const entry = node.items[index];
					const multiplicand = isVariable(entry)
						? getVariableValue(entry)
						: isConstant(entry)
							? getConstantValue(entry)
							: renderNode(entry, null);
					commands.push(
						`scoreboard players operation ${accumulator.target} *= ${multiplicand.target}`,
					);
					release(multiplicand);
				}
				return accumulator;
			}
			case "Literal":
				return getConstantValue(node);
			case "Identifier":
				return getVariableValue(node);
			case "Call":
				throw CompilerError.create(
					"Function calls are not supported in eq expressions",
					null,
					context,
				);
			case "Conditional":
				throw CompilerError.create(
					"Conditional expressions are not supported in eq expressions",
					null,
					context,
				);
			default:
				throw new Error("Unsupported expression form during eq rendering");
		}
	};

	const applyResult = () => {
		const literalRoot = isConstant(root);
		const variableRoot = isVariable(root);

		if (finalOp === "=") {
			if (literalRoot) {
				const value = getValue(root);
				commands.push(`scoreboard players set ${result} ${value}`);
				return;
			}

			if (variableRoot) {
				commands.push(
					`scoreboard players operation ${result} = ${getVariableValue(root).target}`,
				);
				return;
			}

			const stored = renderNode(root, result);
			if (stored.target !== result) {
				commands.push(
					`scoreboard players operation ${result} = ${stored.target}`,
				);
			}
			release(stored);
			return;
		}

		if (literalRoot) {
			const value = getValue(root);
			switch (finalOp) {
				case "+=":
					if (value > 0) {
						commands.push(`scoreboard players add ${result} ${value}`);
					} else if (value < 0) {
						commands.push(`scoreboard players remove ${result} ${-value}`);
					}
					return;
				case "-=":
					if (value > 0) {
						commands.push(`scoreboard players remove ${result} ${value}`);
					} else if (value < 0) {
						commands.push(`scoreboard players add ${result} ${-value}`);
					}
					return;
				case "*=":
					if (value === 0) {
						commands.push(`scoreboard players set ${result} 0`);
						return;
					}
					if (value === 1) {
						return;
					}
					if (value === -1) {
						adjustConstantUsage(-1);
						commands.push(
							`scoreboard players operation ${result} *= -1 ${constObjective}`,
						);
						return;
					}
					commands.push(
						`scoreboard players operation ${result} *= ${getConstantValue(root).target}`,
					);
					return;
				case "/=":
					if (value === 0) {
						throw CompilerError.create(
							"Division by zero in eq expression",
							null,
							context,
						);
					}
					if (value === 1) {
						return;
					}
					commands.push(
						`scoreboard players operation ${result} /= ${getConstantValue(root).target}`,
					);
					return;
				case "%=":
					if (value === 0) {
						throw CompilerError.create(
							"Modulo by zero in eq expression",
							null,
							context,
						);
					}
					if (value === 1) {
						commands.push(`scoreboard players set ${result} 0`);
						return;
					}
					commands.push(
						`scoreboard players operation ${result} %= ${getConstantValue(root).target}`,
					);
					return;
				default:
					throw new Error(
						`Unsupported operator '${finalOp}' for literal eq expression`,
					);
			}
		}

		if (variableRoot) {
			commands.push(
				`scoreboard players operation ${result} ${finalOp} ${getVariableValue(root).target}`,
			);
			return;
		}

		const preferredTarget = finalOp === "=" ? result : null;
		const stored = renderNode(root, preferredTarget);
		commands.push(
			`scoreboard players operation ${result} ${finalOp} ${stored.target}`,
		);
		release(stored);
	};

	applyResult();

	return {
		commands: commands.join("\n"),
		constants: Array.from(constantUsage.keys()),
	};
}

package mcl;

import js.lib.Set;
import js.html.rtc.SessionDescriptionInit;
import haxpression.ValueType;
import haxpression.ExpressionType;
import haxpression.Parser;

using StringTools;

enum FlattenedType {
	FLiteral(value:ValueType);
	FIdentifier(name:String);
	FUnary(operant:String, operand:FlattenedType);
	FBinary(operant:String, left:FlattenedType, right:FlattenedType);
	FAdd(item:Array<FlattenedType>);
	FMul(item:Array<FlattenedType>);
	FCall(callee:String, args:Array<FlattenedType>);
	FConditional(test:FlattenedType, consequent:FlattenedType, alternate:FlattenedType);
	FArray(items:Array<FlattenedType>);
	FCompound(items:Array<FlattenedType>);
}

class McMath {
	static function stringify(exp:FlattenedType):String {
		switch (exp) {
			case FLiteral(value):
				return switch (value) {
					case VFloat(v):
						'$v';
					case VInt(v):
						'$v';
					case VString(v):
						'$v';
					case VBool(v):
						'$v';
					default:
						throw "unsupported literal";
				};
			case FIdentifier(name):
				return name;
			case FUnary(operant, operand):
				return operant + stringify(operand);
			case FBinary(operant, left, right):
				return stringify(left) + operant + stringify(right);
			case FAdd(items):
				return '(' + items.map(stringify).join(" + ") + ')';
			case FMul(items):
				return '(' + items.map(stringify).join(" * ") + ')';
			case FCall(callee, args):
				return callee + "(" + args.map(stringify).join(", ") + ")";
			case FConditional(test, consequent, alternate):
				return stringify(test) + " ? " + stringify(consequent) + " : " + stringify(alternate);
			case FArray(items):
				return "[" + items.map(stringify).join(", ") + "]";
			case FCompound(items):
				return "{" + items.map(stringify).join(", ") + "}";
		}
	}

	static function flatten(exp:ExpressionType):FlattenedType {
		switch (exp) {
			case ELiteral(value):
				return FLiteral(value);
			case EIdentifier(name):
				return FIdentifier(name);
			case EUnary(operant, operand):
				return FUnary(operant, flatten(operand));
			case EBinary(operant, left, right):
				if (operant == '+') {
					var entries = new Array<FlattenedType>();
					var literals:Int = 0;
					function flattenAdd(exp:ExpressionType) {
						switch (exp) {
							case EBinary('+', left, right):
								flattenAdd(left);
								flattenAdd(right);
							case ELiteral(value):
								switch (value) {
									case VFloat(v) if (v == Math.floor(v)):
										literals += Math.floor(v);
									case VInt(v):
										literals += v;
									default:
										entries.push(flatten(exp));
								}
							default:
								entries.push(flatten(exp));
						}
					}
					flattenAdd(exp);
					if (literals != 0)
						entries.push(FLiteral(VInt(literals)));
					return FAdd(entries);
				}
				if (operant == '*') {
					var entries = new Array<FlattenedType>();
					var literals:Int = 1;
					function flattenMul(exp:ExpressionType) {
						switch (exp) {
							case EBinary('*', left, right):
								flattenMul(left);
								flattenMul(right);
							case ELiteral(value):
								switch (value) {
									case VFloat(v) if (v == Math.floor(v)):
										literals *= Math.floor(v);
									case VInt(v):
										literals *= v;
									default:
										entries.push(flatten(exp));
								}
							default:
								entries.push(flatten(exp));
						}
					}
					flattenMul(exp);
					if (literals != 1)
						entries.push(FLiteral(VInt(literals)));
					return FMul(entries);
				}
				return FBinary(operant, flatten(left), flatten(right));
			case ECall(callee, args):
				return FCall(callee, args.map(flatten));
			case EConditional(test, consequent, alternate):
				return FConditional(flatten(test), flatten(consequent), flatten(alternate));
			case EArray(items):
				return FArray(items.map(flatten));
			case ECompound(items):
				return FCompound(items.map(flatten));
		}
	}

	static function organize(exp:ExpressionType):ExpressionType {
		switch (exp) {
			case ELiteral(value):
				switch (value) {
					case VFloat(v):
						return ELiteral(VFloat(v));
					case VInt(v):
						return ELiteral(VInt(v));
					case VString(v):
						return ELiteral(VString(v));
					case VBool(v):
						return ELiteral(VBool(v));
					default:
						throw "unsupported literal";
				}
			case EIdentifier(name):
				return EIdentifier(name);
			case EUnary(operant, operand):
				return EUnary(operant, organize(operand));
			case EBinary(operant, ELiteral(a), right):
				var v:Int = switch (a) {
					case VFloat(v) if (v == Math.floor(v)):
						Math.floor(v);
					case VInt(v):
						v;
					default:
						return EBinary(operant, ELiteral(a), organize(right));
				}
				if (operant == '+')
					return EBinary(operant, organize(right), ELiteral(VInt(v)));
				if (operant == '-')
					return EBinary("+", organize(right), ELiteral(VInt(-v)));
				if (operant == '*')
					return EBinary(operant, organize(right), ELiteral(VInt(v)));
				return EBinary(operant, ELiteral(a), organize(right));
			case EBinary("-", left, ELiteral(value)):
				var v:Int = switch (value) {
					case VFloat(v) if (v == Math.floor(v)):
						Math.floor(v);
					case VInt(v):
						v;
					default:
						return EBinary("-", organize(left), ELiteral(value));
				}
				return EBinary("+", organize(left), ELiteral(VInt(-v)));
			case EBinary(operant, left, right):
				return EBinary(operant, organize(left), organize(right));
			case ECall(name, args):
				return ECall(name, args.map(organize));
			case EConditional(test, consequent, alternate):
				return EConditional(organize(test), organize(consequent), organize(alternate));
			case EArray(items):
				return EArray(items.map(organize));
			case ECompound(items):
				return ECompound(items.map(organize));
		}
	}

	public static function compile(eq:String, context:mcl.Compiler.CompilerContext) {
		for (i in 0...eq.length) {
			if (eq.charAt(i) == '@' && eq.charAt(i + 1) != "s" && eq.charAt(i + 2) != "[") {
				throw 'only unrestricted @s selectors are allowed in equations to avoid unexpected behavior.';
			}
		}
		function skip() {
			var idx = 0;
			while (eq.charAt(idx) == " " && idx < eq.length) {
				idx++;
			}
			eq = eq.substring(idx);
		}
		function collect() {
			var value = "";
			var idx = 0;
			while (eq.charAt(idx) != " " && idx < eq.length) {
				value += eq.charAt(idx);
				idx++;
			}
			eq = eq.substring(idx);
			return value;
		}
		var lhs = collect();
		skip();
		lhs += " " + collect();
		skip();
		var sep = collect();
		skip();
		var rhs = eq;
		var variables = new Map<String, String>();
		var idx = 0;
		function isAlphaNumeric(c:String) {
			var code = c.fastCodeAt(0);
			return (code >= 'a'.code && code <= 'z'.code)
				|| (code >= 'A'.code && code <= 'Z'.code)
				|| (code >= '0'.code && code <= '9'.code)
				|| code == '.'.code
				|| code == '_'.code
				|| code == '$'.code
				|| code == '#'.code
				|| code == "@".code;
		}
		var varnameIdx = 0;
		function getNextVarName():String {
			varnameIdx++;
			return "var" + varnameIdx;
		}
		var newEquation = "";
		while (idx < rhs.length) {
			var c = rhs.charAt(idx);
			var code = c.charCodeAt(0);
			if (code == "@".code || code >= 'a'.code && code <= 'z'.code || code >= 'A'.code && code <= 'Z'.code) {
				var name = "";
				while (idx < rhs.length && isAlphaNumeric(rhs.charAt(idx))) {
					name += rhs.charAt(idx);
					idx++;
				}
				idx++;
				name += " ";
				while (idx < rhs.length && isAlphaNumeric(rhs.charAt(idx))) {
					name += rhs.charAt(idx);
					idx++;
				}
				if (!variables.exists(name))
					variables.set(name, getNextVarName());
				newEquation += variables.get(name);
			} else {
				newEquation += c;
				idx++;
			}
		}
		var x = flatten(organize(Parser.parse(newEquation).simplify()));
		return render(x, lhs, [for (k => v in variables) v => k], sep, context);
	}

	static function render(x:FlattenedType, result:String, variables:haxe.ds.Map<String, String>, finalOp:String, context:mcl.Compiler.CompilerContext) {
		var commands:Array<String> = [];
		var idx = 0;
		var unsafeToModify = new Map<String, Bool>();
		var const = context.compiler.config.eqConstScoreboardName;
		var temp = context.compiler.config.eqVarScoreboardName;
		var constantValues = new Map<Int, Int>();
		function c(v:Int, remove:Bool = false) {
			if (remove) {
				var count = constantValues.get(v);
				count--;
				if (count <= 0) {
					constantValues.remove(v);
				} else {
					constantValues.set(v, count);
				}
			} else {
				var count = constantValues.get(v);
				if (count == null) {
					count = 1;
				} else {
					count++;
				}
				constantValues.set(v, count);
			}
		}
		for (k => v in variables) {
			unsafeToModify.set(v, true);
		}
		function isSafeToModify(s:String):Bool {
			if (unsafeToModify.exists(s))
				return false;
			if (s.endsWith(' $const'))
				return false;
			return true;
		}
		function mkTemp(from:String, ?alt:String) {
			if (alt != null && isSafeToModify(alt)) {
				commands.push('scoreboard players operation $alt = $from');
				return alt;
			}
			var id = 'tmp${idx++} $temp';
			if (from.endsWith(' $const')) {
				c(Std.parseInt(from.substring(0, from.length - 6)), true);
				commands.push('scoreboard players set $id ${from.substring(0, from.length - 6)}');
			} else
				commands.push('scoreboard players operation $id = $from');
			return id;
		}
		function makeSafe(v:String, ?alt:String) {
			if (isSafeToModify(v)) {
				return v;
			}
			return mkTemp(v, alt);
		}
		function isConstant(v:FlattenedType) {
			return switch (v) {
				case FLiteral(_): true;
				default: false;
			}
		}
		function isVariable(v:FlattenedType) {
			return switch (v) {
				case FIdentifier(_): true;
				default: false;
			}
		}
		function getVariable(v:FlattenedType) {
			return switch (v) {
				case FIdentifier(name): return variables.get(name);
				default: throw "not a variable";
			}
		}
		function getValue(v:FlattenedType) {
			switch (v) {
				case FLiteral(value):
					return switch (value) {
						case VFloat(v): v;
						case VInt(v): v;
						default: throw "unsupported literal";
					};
				default:
			}
			throw "not a constant";
		}
		function getConstant(v:FlattenedType) {
			var val = Math.floor(getValue(v));
			c(val);
			return '$val $const';
		}
		function renderNode(node:FlattenedType, output:String) {
			switch (node) {
				case FUnary(operant, operand):
					var l = isVariable(operand) ? makeSafe(getVariable(operand),
						output) : isConstant(operand) ? makeSafe(getConstant(operand), output) : renderNode(operand, output);
					// commands.push('Unary ' + operant + ' ' + l);
					switch (operant) {
						case "-":
							var r = makeSafe(l);
							c(-1);
							commands.push('scoreboard players operation $r *= -1 $const');
							return r;
					}
					return l;
				case FBinary(operant, left, right):
					var l = isVariable(left) ? makeSafe(getVariable(left),
						output) : isConstant(left) ? makeSafe(getConstant(left), output) : renderNode(left, output);
					var r = isVariable(right) ? getVariable(right) : isConstant(right) ? getConstant(right) : renderNode(right, null);
					commands.push('scoreboard players operation ' + l + ' ' + operant + '= ' + r);
					return l;
				case FAdd(items):
					var l = isVariable(items[0]) ? makeSafe(getVariable(items[0]),
						output) : isConstant(items[0]) ? makeSafe(getConstant(items[0]), output) : renderNode(items[0], output);
					for (i in 1...items.length) {
						if (isVariable(items[i]))
							commands.push('scoreboard players operation ' + l + ' += ' + getVariable(items[i]));
						else if (isConstant(items[i])) {
							var v = getValue(items[i]);
							if (v > 0) {
								commands.push('scoreboard players add ' + l + ' ' + v);
							} else if (v < 0) {
								commands.push('scoreboard players remove ' + l + ' ' + (-v));
							}
						} else {
							var r = renderNode(items[i], null);
							commands.push('scoreboard players operation ' + l + ' += ' + r);
						}
					}
					return l;
				case FMul(items):
					var l = isVariable(items[0]) ? makeSafe(getVariable(items[0]),
						output) : isConstant(items[0]) ? makeSafe(getConstant(items[0]), output) : renderNode(items[0], output);
					for (i in 1...items.length) {
						var r = isVariable(items[i]) ? getVariable(items[i]) : isConstant(items[i]) ? getConstant(items[i]) : renderNode(items[i], null);
						commands.push('scoreboard players operation ' + l + ' *= ' + r);
					}
					return l;
				case FCall(callee, args):
					throw "unsupported call";
				case FConditional(test, consequent, alternate):
					throw "unsupported conditional";
				case FArray(items):
					throw "unsupported array";
				case FCompound(items):
					throw "unsupported compound";
				case FLiteral(id):
					return switch (id) {
						case VFloat(v):
							c(Math.floor(v));
							'${Math.floor(v)} $const';
						case VInt(v):
							c(v);
							'$v $const';
						default: throw "unsupported literal";
					}
				case FIdentifier(id):
					throw "NO NO NO NO NO2";
			}
		}
		if (isConstant(x) && finalOp == "=") {
			commands.push('scoreboard players set $result ' + getValue(x));
			// return commands.join("\n");
		} else if (isVariable(x)) {
			commands.push('scoreboard players operation $result $finalOp ' + getVariable(x));
			// return commands.join("\n");
		} else {
			var stored = renderNode(x, result);
			if (result != stored) {
				commands.push('scoreboard players operation $result $finalOp $stored');
			}
		}
		return {commands: commands.join("\n"), constants: [for (k in constantValues.keys()) k]};
	}
}

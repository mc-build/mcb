package haxpression;

import haxpression.ExpressionType;
import haxpression.ValueType;

using StringTools;
using haxpression.utils.Arrays;
using haxpression.utils.Iterators;
using haxpression.utils.Strings;
using haxpression.ExpressionTypes;
using haxpression.Expressions;

abstract Expression(ExpressionType) {
	public inline function new(expressionType:ExpressionType) {
		this = expressionType;
	}

	@:from
	public static function fromExpressionType(expressionType:ExpressionType) {
		return new Expression(expressionType);
	}

	@:to
	public function toExpressionType():ExpressionType {
		return this;
	}

	@:from
	public static function fromString(input:String):Expression {
		return Parser.parse(input);
	}

	public static function fromStringLiteral(input:String):Expression {
		return ELiteral(Value.fromString(input));
	}

	public static function fromInt(input:Int):Expression {
		return ELiteral(Value.fromInt(input));
	}

	public static function fromFloat(input:Float):Expression {
		return ELiteral(Value.fromFloat(input));
	}

	public static function fromBool(input:Bool):Expression {
		return ELiteral(Value.fromBool(input));
	}

	public function toString():String {
		return switch this {
			case ELiteral(value): new Value(value).toString();
			case EIdentifier(name): name;
			case EUnary(_operator, operand): '${_operator}${getString(operand)}';
			case EBinary(_operator, left, right): '(${getString(left)} $_operator ${getString(right)})';
			case ECall(callee, arguments): '${callee}(${getStringDelimited(arguments, ",")})';
			case EConditional(test, consequent, alternate): '(${getString(test)} ? ${getString(consequent)} : ${getString(alternate)})';
			case EArray(items): '[${getStringDelimited(items, ",")}]';
			case ECompound(items): getStringDelimited(items, ";");
		};
	}

	public function toDynamic():Dynamic {
		return switch this {
			case ELiteral(value): new Value(value).toDynamic();
			case _: toString();
		};
	}

	public function toObject():{} {
		return switch this {
			case ELiteral(value): {
					type: "Literal",
					value: new Value(value).toDynamic() // allow the value to be passed-through with no conversion
				};
			case EIdentifier(name): {
					type: "Identifier",
					name: name
				};
			case EUnary(_operator, operand): {
					type: "Unary",
					_operator: _operator,
					operand: (operand : Expression).toObject()
				};
			case EBinary(_operator, left, right): {
					type: "Binary",
					_operator: _operator,
					left: (left : Expression).toObject(),
					right: (right : Expression).toObject()
				};
			case ECall(callee, arguments): {
					type: "Call",
					callee: callee,
					arguments: arguments.toObject()
				};
			case EConditional(test, consequent, alternate): {
					type: "Conditional",
					test: (test : Expression).toObject(),
					consequent: (consequent : Expression).toObject(),
					alternate: (alternate : Expression).toObject()
				};
			case EArray(items): {
					type: "Array",
					items: items.toObject()
				};
			case ECompound(items): {
					type: "Compound",
					items: items.toObject()
				};
		};
	}

	public function hasVariables():Bool {
		return getVariables().length > 0;
	}

	public function hasVariablesStartingWith(text:String) {
		return getVariables().any(function(variable) {
			return variable.startsWith(text);
		});
	}

	public function hasVariablesContaining(text:String) {
		return getVariables().any(function(variable) {
			return variable.contains(text);
		});
	}

	public function hasVariablesEndingWith(text:String) {
		return getVariables().any(function(variable) {
			return variable.endsWith(text);
		});
	}

	public function hasVariablesWithin(variables:Array<String>):Bool {
		return getVariables().all(function(variable) {
			return variables.contains(variable);
		});
	}

	public function getVariables(?options:{?sort:Bool}):Array<String> {
		if (options == null)
			options = {};
		if (options.sort == null)
			options.sort = true;
		var variables = [];
		accumulateVariables(variables);
		if (options.sort) {
			variables.sort(function(a, b) {
				a = a.toLowerCase();
				b = b.toLowerCase();
				return if (a > b) 1; else if (a < b) -1; else 0;
			});
		}
		return variables;
	}

	public function clone():Expression {
		if (!Config.useCloneForExpressions) {
			return this;
		}

		return switch this {
			case ELiteral(value):
				ELiteral(value);
			case EIdentifier(name):
				EIdentifier(name);
			case EUnary(_operator, operand):
				EUnary(_operator, (operand : Expression).clone());
			case EBinary(_operator, left, right):
				EBinary(_operator, (left : Expression).clone(), (right : Expression).clone());
			case ECall(callee, arguments):
				ECall(callee, arguments.clone());
			case EConditional(test, consequent, alternate):
				EConditional((test : Expression).clone(), (consequent : Expression).clone(), (alternate : Expression).clone());
			case EArray(items):
				EArray(items.clone());
			case ECompound(items):
				ECompound(items.clone());
		};
	}

	public function substitute(variables:Map<String, ExpressionOrValue>):Expression {
		return switch this {
			case ELiteral(value):
				ELiteral(value);
			case EIdentifier(name):
				variables.exists(name) ? variables.get(name).toExpression() : EIdentifier(name);
			case EUnary(_operator, expression):
				EUnary(_operator, (expression : Expression).substitute(variables));
			case EBinary(_operator, left, right):
				EBinary(_operator, (left : Expression).substitute(variables), (right : Expression).substitute(variables));
			case ECall(callee, arguments):
				ECall(callee, arguments.substitute(variables));
			case EConditional(test, consequent, alternate):
				EConditional((test : Expression).substitute(variables), (consequent : Expression).substitute(variables),
					(alternate : Expression).substitute(variables));
			case EArray(items):
				EArray(items.substitute(variables));
			case ECompound(items):
				EArray(items.substitute(variables));
		};
	}

	public function simplify():Expression {
		return switch this {
			case ELiteral(value):
				ELiteral(value);
			case EIdentifier(name):
				EIdentifier(name);
			case EUnary(_operator, operand):
				if ((operand : Expression).canEvaluate()) {
					ELiteral(UnaryOperations.evaluate(_operator, (operand : Expression).evaluate()));
				} else {
					EUnary(_operator, (operand : Expression).simplify().toExpressionType());
				}
			case EBinary(_operator, left, right):
				if ((left : Expression).canEvaluate() && (right : Expression).canEvaluate()) {
					ELiteral(BinaryOperations.evaluate(_operator, (left : Expression).evaluate(), (right : Expression).evaluate()));
				} else {
					EBinary(_operator, (left : Expression).simplify(), (right : Expression).simplify());
				}
			case EConditional(test, consequent, alternate):
				if ((test : Expression).canEvaluate()) {
					(test : Expression).evaluate() ? (consequent : Expression).simplify() : (alternate : Expression).simplify();
				} else {
					EConditional((test : Expression).simplify(), (consequent : Expression).simplify(), (alternate : Expression).simplify());
				}
			case ECall(callee, arguments):
				if (arguments.canEvaluateAll()) {
					return ELiteral(CallOperations.evaluate(callee, arguments.evaluate()));
				} else {
					ECall(callee, arguments.simplify());
				}
			case EArray(items):
				EArray(items.simplify());
			case ECompound(items):
				ECompound(items.simplify());
		};
	}

	public function canEvaluate():Bool {
		return switch this {
			case ELiteral(value):
				true;
			case EIdentifier(name):
				false;
			case EUnary(_operator, operand):
				(operand : Expression).canEvaluate();
			case EBinary(_operator, left, right):
				(left : Expression).canEvaluate() && (right : Expression).canEvaluate();
			case ECall(callee, arguments):
				CallOperations.canEvaluate(callee, arguments);
			case EConditional(test, consequent, alternate):
				if (!(test : Expression).canEvaluate()) {
					false;
				} else {
					(test : Expression).evaluate() ? (consequent : Expression).canEvaluate() : (alternate : Expression).canEvaluate();
				}
			case EArray(items):
				items.canEvaluateAll();
			case ECompound(items):
				items.canEvaluateAll();
		};
	}

	public function evaluate(?variables:Map<String, Value>):Value {
		if (variables == null)
			variables = new Map();

		return switch this {
			case ELiteral(value):
				value;
			case EIdentifier(name):
				if (!variables.exists(name)) {
					throw new Error('cannot evaluate expression with unset variable: $name');
				}
				variables.get(name);
			case EUnary(_operator, operand):
				var operandValue = (operand : Expression).evaluate(variables);
				UnaryOperations.evaluate(_operator, operandValue);
			case EBinary(_operator, left, right):
				var leftValue = (left : Expression).evaluate(variables);
				var rightValue = (right : Expression).evaluate(variables);
				BinaryOperations.evaluate(_operator, leftValue, rightValue);
			case ECall(callee, arguments):
				CallOperations.evaluate(callee, arguments.evaluate(variables));
			case EConditional(test, consequent, alternate):
				(test : Expression).evaluate(variables)
					.toBool() ? (consequent : Expression).evaluate(variables) : (alternate : Expression).evaluate(variables);
			case EArray(items):
				// We'll just assume the value of an array expression is the last value
				// or none if there are no items in the array
				if (items.length == 0) VNA; else {
					var values = items.evaluate(variables);
					values[values.length - 1];
				}
			case ECompound(items):
				// We'll just assume the value of an compound expression is the last value
				// or none if there are no items in the array
				if (items.length == 0) VNA; else {
					var values = items.evaluate(variables);
					values[values.length - 1];
				}
		};
	}

	public function isLiteral(?value:Value):Bool {
		return switch [toExpressionType(), value.toValueType()] {
			case [ELiteral(VInt(a)), VInt(b)]: a == b;
			case [ELiteral(VFloat(a)), VFloat(b)]: a == b;
			case [ELiteral(VString(a)), VString(b)]: a == b;
			case [ELiteral(VBool(a)), VBool(b)]: a == b;
			case _: false;
		};
	}

	public function isIdentifier(?name:String):Bool {
		return switch toExpressionType() {
			case EIdentifier(n): name != null ? name == n : true;
			case _: false;
		};
	}

	public function isCompound():Bool {
		return switch toExpressionType() {
			case ECompound(_): true;
			case _: false;
		};
	}

	/*
		  public function equals(right : Expression) : Bool {
		return switch [this, right.toExpressionType()] {
		  case [Literal(l), Literal(r)] : l.equals(r);
		  case [Identifier(l), Identifier(r)] : l == r;
		  case [Unary(lop, l), Unary(rop, r)] : lop == rop && l.equals(r);
		  case [Binary(lop, ll, lr), Binary(rop, rl, rr)] : lop == rop && ll.equals(rl) && lr.equals(rr);
		  case [Call(lc, ls), Call(rc, rs)] : lc == rc && ls.length == rs.length && ls.length.range
		  //case [_, _] : false;
		};
		  }
	 */
	function accumulateVariables(variables:Array<String>):Void {
		switch this {
			case ELiteral(value):
			// no-op - no variables to accumulate here
			case EIdentifier(name):
				// Push a variable if we haven't seen it already
				if (variables.indexOf(name) == -1)
					variables.push(name);
			case EUnary(_operator, operand):
				(operand : Expression).accumulateVariables(variables);
			case EBinary(_operator, left, right):
				(left : Expression).accumulateVariables(variables);
				(right : Expression).accumulateVariables(variables);
			case ECall(callee, arguments):
				arguments.each(function(expression)(expression:Expression).accumulateVariables(variables));
			case EConditional(test, consequent, alternate):
				(test : Expression).accumulateVariables(variables);
				(consequent : Expression).accumulateVariables(variables);
				(alternate : Expression).accumulateVariables(variables);
			case EArray(items):
				items.each(function(expression)(expression:Expression).accumulateVariables(variables));
			case ECompound(items):
				items.each(function(expression)(expression:Expression).accumulateVariables(variables));
		};
	}

	function getString(expressionType:ExpressionType):String {
		return (expressionType : Expression).toString();
	}

	function getStringDelimited(expressionTypes:Array<ExpressionType>, delimiter:String):String {
		delimiter = '${delimiter.trim()} ';
		return expressionTypes.map(getString).join(delimiter);
	}
}

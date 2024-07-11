package haxpression;

import haxpression.ExpressionType;
import haxpression.ValueType;
import haxpression.utils.Chars;
using StringTools;

class Parser {
  var inputString : String;
  var index : Int;
  var length : Int;
  var expressions : Array<Expression>;

  function new(inputString : String) {
    this.inputString = inputString;
    this.index = 0;
    this.length = inputString.length;
    this.expressions = [];
  }

  public static function parse(input : String) : Expression {
    var parser = new Parser(input);
    return parser.internalParse();
  }

  function internalParse() : Expression {
    while (index < length) {
      var charCode = charCodeAt(index);
      if (charCode == Chars.SEMICOLON_CODE || charCode == Chars.COMMA_CODE) {
        index++;
      } else {
        var expression = gobbleExpression();

        if (expression != null) {
          expressions.push(expression);
        } else if (index < length) {
          throw new Error('unexpected internal parse "${charAt(index)}"', inputString, index);
        }
      }
    }

    return if (expressions.length == 1) {
      expressions[0];
    } else {
      ECompound(expressions.map(function(expression) return expression.toExpressionType()));
    }
  }

  function charAt(index : Int) : String {
    return inputString.charAt(index);
  }

  function charCodeAt(index : Int) : Int {
    return inputString.charCodeAt(index);
  }

  function gobbleSpaces() : Void {
    var charCode = charCodeAt(index);
    while (index < length && Chars.isWhiteSpace(charCode)) {
      charCode = charCodeAt(++index);
    }
  }

  function gobbleExpression() : Expression {
    var expression = gobbleBinaryExpression();
    gobbleSpaces();
    if (charCodeAt(index) == Chars.QUESTION_MARK_CODE) {
      index++;
      var consequent = gobbleExpression();
      if (consequent == null) {
        throw new Error('expected a "consequent" expression for ternary conditional expression', inputString, index);
      }
      gobbleSpaces();
      if (charCodeAt(index) == Chars.COLON_CODE) {
        index++;
        var alternate = gobbleExpression();
        if (alternate == null) {
          throw new Error('expected an "alternate" expression for ternary conditional expression', inputString, index);
        }
        return EConditional(expression, consequent, alternate);
      }
    }

    // Not a conditional - just return the expression
    return expression;
  }

  function gobbleBinaryOperator() : Null<String> {
    gobbleSpaces();
    var toCheck : String = inputString.substr(index, BinaryOperations.getMaxOperatorLength());
    var toCheckLength : Int = toCheck.length;
    while (toCheckLength > 0) {
      if (BinaryOperations.hasOperator(toCheck)) {
        index += toCheckLength;
        return toCheck;
      }
      toCheckLength = toCheckLength - 1;
      toCheck = toCheck.substr(0, toCheckLength);
    }
    return null; // not an operator
  }

  function gobbleBinaryExpression() : Expression {
    var char : String;
    var expression : Expression;
    var binaryOperator : String;
    var precedence : Int;
    var stack : Array<Dynamic>;
    var binaryOperatorInfo : { operator : String, precedence : Int };
    var left : Expression;
    var right : Expression;
    var left = gobbleToken();
    var binaryOperator = gobbleBinaryOperator();
    if (binaryOperator == null) {
      return left;
    }
    binaryOperatorInfo = {
      operator: binaryOperator,
      precedence: BinaryOperations.getOperatorPrecedence(binaryOperator)
    };
    var right = gobbleToken();
    if (right == null) {
      throw new Error('expected expression after binary operator: "$binaryOperator"', inputString, index);
    }

    // TODO: This code is untyped because of how the original jsepimplementation worked.
    // Could be cleaned up.
    var stack : Array<Dynamic> = [left, binaryOperatorInfo, right];

    while ((binaryOperator = gobbleBinaryOperator()) != null) {
      precedence = BinaryOperations.getOperatorPrecedence(binaryOperator);

      if (precedence == 0) {
        break;
      }

      binaryOperatorInfo = {
        operator: binaryOperator,
        precedence: precedence
      };

      while ((stack.length > 2) && (precedence <= stack[stack.length - 2].precedence)) {
        right = stack.pop();
        binaryOperator = stack.pop().operator;
        left = stack.pop();
        var expression = EBinary(binaryOperator, left, right);
        stack.push(expression);
      }

      expression = gobbleToken();
      if (expression == null) {
        throw new Error('expected expression after binary operator: "$binaryOperator"', inputString, index);
      }
      stack.push(binaryOperatorInfo);
      stack.push(expression);
    }

    var i = stack.length - 1;
    expression = stack[i];
    while (i > 1) {
      expression = EBinary(stack[i - 1].operator, stack[i - 2], expression);
      i -= 2;
    }

    return expression;
  }

  function gobbleToken() : Null<Expression> {
    gobbleSpaces();

    var charCode = charCodeAt(index);


    if (Chars.isDecimalDigit(charCode) || charCode == Chars.PERIOD_CODE) {
      return gobbleNumericLiteral();
    } else if (charCode == Chars.SINGLE_QUOTE_CODE || charCode == Chars.DOUBLE_QUOTE_CODE) {
      return gobbleStringLiteral();
    } else if (Chars.isIdentifierStart(charCode) || charCode == Chars.OPEN_PAREN_CODE) {
      return gobbleVariable();
    } else if (charCode == Chars.OPEN_BRACKET_CODE) {
      return gobbleArray();
    } else {
      // Try to gobble unary operator expression
      var toCheck : String = inputString.substr(index, UnaryOperations.getMaxOperatorLength());
      var toCheckLength : Int = toCheck.length;
      while (toCheckLength > 0) {
        if (UnaryOperations.hasOperator(toCheck)) {
          index += toCheckLength;
          return EUnary(toCheck, gobbleToken());
        }
        toCheckLength = toCheckLength - 1;
        toCheck = toCheck.substr(0, toCheckLength);
      }

      // No expression found
      return null;
    }
  }

  function gobbleNumericLiteral() : Expression {
    var numberString = "";
    while (index < length && Chars.isDecimalDigit(charCodeAt(index))) {
      numberString += charAt(index++);
    }

    if (charCodeAt(index) == Chars.PERIOD_CODE) {
      numberString += charAt(index++);

      while (index < length && Chars.isDecimalDigit(charCodeAt(index))) {
        numberString += charAt(index++);
      }
    }

    // check for exponent
    var char = charAt(index);
    if (char == "e" || char == "E") {
      numberString += charAt(index++);
      char = charAt(index);
      if (char == "+" || char == "-") {
        numberString += charAt(index++);
      }

      while (index < length && Chars.isDecimalDigit(charCodeAt(index))) {
        numberString += charAt(index++);
      }

      if (!Chars.isDecimalDigit(charCodeAt(index - 1))) {
        throw new Error('expected exponent in numeric literal: "${numberString}${charAt(index)}"', inputString, index);
      }
    }

    if(index >= length)
      return ELiteral(VFloat(Std.parseFloat(numberString)));

    var charCode = charCodeAt(index);


    if (Chars.isIdentifierStart(charCode)) {
      throw new Error('variable names cannot start with a number: "${numberString}${charAt(index)}"', inputString, index);
    } else if (charCode == Chars.PERIOD_CODE) {
      throw new Error('unexpected period in numeric literal: "${numberString}${charAt(index)}"', inputString, index);
    }


    return ELiteral(VFloat(Std.parseFloat(numberString)));
  }

  function gobbleStringLiteral() : Expression {
    var str = "";
    var quote = charAt(index++);
    var closed = false;

    while (index < length) {
      var char = charAt(index++);
      if (char == quote) {
        closed = true;
        break;
      } else if (char == "\\") {
        char = charAt(index++);
        switch char {
          case "n": str += '\n';
          case "r": str += '\r';
          case "t": str += '\t';
          //case "b": str += '\b'; // haxe error
          //case "f": str += '\f'; // haxe error
          case "v": str += '\x0B';
        };
      } else {
        str += char;
      }
    }

    if (!closed) {
      throw new Error('unclosed quote after: "$str"', inputString, index);
    }

    return ELiteral(VString(str));
  }

  function gobbleIdentifier() : Expression {
    var charCode = charCodeAt(index);
    var start = index;
    var identifier : String;

    if (Chars.isIdentifierStart(charCode)) {
      index++;
    } else {
      throw new Error('unexpected ${charAt(index)}', inputString, index);
    }

    while (index < length) {
      charCode = charCodeAt(index);
      if (Chars.isIdentifierPart(charCode)){
        index++;
      } else {
        break;
      }
    }

    identifier = inputString.substring(start, index);

    // Special identifiers that are actually values
    return switch identifier.toLowerCase() {
      case "true" : ELiteral(VBool(true));
      case "false" : ELiteral(VBool(false));
      case "null" : ELiteral(VNA);
      case "undefined" : ELiteral(VNA);
      case "na" : ELiteral(VNA);
      case "nm" : ELiteral(VNM);
      case _ : EIdentifier(identifier);
    };
  }

  function gobbleArguments(terminationCharCode : Int) : Array<Expression> {
    var expressions : Array<Expression> = [];
    var sawTermination = false;

    while (index < length) {
      gobbleSpaces();
      var charCode = charCodeAt(index);

      if (charCode == terminationCharCode) {
        sawTermination = true;
        index++;
        break;
      } else if (charCode == Chars.COMMA_CODE) {
        index++;
      } else {
        var expression = gobbleExpression();
        if (expression == null || expression.isCompound()) {
          throw new Error('expected comma between arguments', inputString, index);
        }
        expressions.push(expression);
      }
    }

    if (!sawTermination) {
      var char = String.fromCharCode(terminationCharCode);
      throw new Error('expected termination character: "$char"', inputString, index);
    }

    return expressions;
  }

  function gobbleVariable() : Expression {
    var charCode = charCodeAt(index);
    var expression : Expression;

    if (charCode == Chars.OPEN_PAREN_CODE) {
      expression = gobbleGroup();
    } else {
      expression = gobbleIdentifier();
    }

    gobbleSpaces();

    if(index < length) {
      charCode = charCodeAt(index);

      while (index < length && (charCode == Chars.PERIOD_CODE || charCode == Chars.OPEN_BRACKET_CODE || charCode == Chars.OPEN_PAREN_CODE)) {
        index++;

        if (charCode == Chars.PERIOD_CODE) {
          // TODO: add support for this?
          throw new Error('member access expressions like "a.b" are not supported', inputString, index);
        } else if (charCode == Chars.OPEN_BRACKET_CODE) {
          // TODO: add support for this?
          throw new Error('member access expressions like "a["b"]" are not supported', inputString, index);
        } else if (charCode == Chars.OPEN_PAREN_CODE) {
          var callee = switch expression.toExpressionType() {
            case EIdentifier(name) : name;
            case _: throw new Error('expected function name identifier for function call expression', inputString, index);
          };
          var arguments = gobbleArguments(Chars.CLOSE_PAREN_CODE)
          .map(function(expression) return expression.toExpressionType());
          expression = ECall(callee, arguments);
        }
        gobbleSpaces();
        charCode = charCodeAt(index);
      }
    }

    return expression;
  }


  function gobbleGroup() : Expression {
    index++;
    var expression = gobbleExpression();

    if (charCodeAt(index) == Chars.CLOSE_PAREN_CODE) {
      index++;
      return expression;
    } else {
      throw new Error('unclosed (', inputString, index);
    }
  }

  function gobbleArray() : Expression {
    index++;
    var items = gobbleArguments(Chars.CLOSE_BRACKET_CODE)
      .map(function(expression) return expression.toExpressionType());
    return EArray(items);
  }
}

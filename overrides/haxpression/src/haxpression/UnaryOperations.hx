package haxpression;

import Lambda;
import haxpression.ValueType;
using haxpression.utils.Arrays;
using haxpression.utils.Iterators;

class UnaryOperations {
  static var map(default, null) : Map<String, { operation: Value -> Value }>;

  public static function __init__() {
    map = new Map();
    addOperator("-", function(value) return value.toFloat() * -1);
    addOperator("+", function(value) return value.toFloat() * 1);
    addOperator("!", function(value) return !(value.toBool()));
    addOperator("~", function(value) return ~(value.toInt()));
  }

  public static function evaluate(operator : String, value : Value) : Value {
    return map.get(operator).operation(value);
  }

  public static function addOperator(operator : String, operation : Value -> Value) {
    map.set(operator, {
      operation: wrapOperation(operation)
    });
  }

  public static function removeOperator(operator : String) {
    map.remove(operator);
  }

  public static function hasOperator(operator : String) : Bool {
    return map.exists(operator);
  }

  public static function clearOperators() {
    map = new Map();
  }

  public static function getMaxOperatorLength() : Int {
    return map.keys().toArray().reduce(function(maxLength : Int, key : String) : Int {
      return key.length > maxLength ? key.length : maxLength;
    }, 0);
  }

  static function wrapOperation(operation : Value -> Value) : Value -> Value {
    return function(value : Value) : Value {
      return if (value.isNA()) return VNA;
        else if (value.isNM()) return VNM;
        else operation(value);
    }
  }
}

package haxpression;

enum ExpressionType {
  ELiteral(value : ValueType);
  EIdentifier(name : String);
  EUnary(operator : String, operand : ExpressionType);
  EBinary(operator : String, left : ExpressionType, right : ExpressionType);
  ECall(callee : String, arguments : Array<ExpressionType>);
  EConditional(test : ExpressionType, consequent : ExpressionType, alternate : ExpressionType);
  EArray(items : Array<ExpressionType>);
  ECompound(items : Array<ExpressionType>);
}

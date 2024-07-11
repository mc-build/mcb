package haxpression;

enum ExpressionType {
	ELiteral(value:ValueType);
	EIdentifier(name:String);
	EUnary(_operator:String, operand:ExpressionType);
	EBinary(_operator:String, left:ExpressionType, right:ExpressionType);
	ECall(callee:String, arguments:Array<ExpressionType>);
	EConditional(test:ExpressionType, consequent:ExpressionType, alternate:ExpressionType);
	EArray(items:Array<ExpressionType>);
	ECompound(items:Array<ExpressionType>);
}

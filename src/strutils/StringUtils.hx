package strutils;

import haxe.macro.ExprTools;
import haxe.macro.Expr;

// #if macro
class StringUtils {
	public static macro function startsWithConstExpr(str:Expr, prefix:String):Expr {
		var i = 0;
		var arr = prefix.split('').map(function(c) return macro $v{c} == v.charAt($v{i++}));
		var item = arr[0];
		arr.shift();
		function join(a, b)
			return macro $a && $b;

		while (arr.length > 0) {
			item = join(item, arr[0]);
			arr.shift();
		}
		return macro {
			var v = $str;
			${item}
		}
	}
}
// #end

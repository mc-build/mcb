package mcl;

import js.lib.Object;
import js.Syntax;
import Type.ValueType;
import haxe.iterators.ArrayIterator;

private class IteratorWrapper<T> {
	private var iteratorValue:Iterator<T>;

	public function new(iterator:Iterator<T>) {
		this.iteratorValue = iterator;
	}

	public function iterator():Iterator<T> {
		return this.iteratorValue;
	}
}

@:keep
class McFloatIterator {
	private var min:Float;
	private var max:Float;
	private var current:Float;
	private var offset:Float;

	public function new(min:Float, max:Float, step:Float) {
		this.min = min;
		this.max = max;
		this.current = min;
		this.offset = step;
		if (step < 0 && min < max) {
			throw "Invalid step for range";
		}
		if (step > 0 && min > max) {
			throw "Invalid step for range";
		}
	}

	public function hasNext():Bool {
		return (this.offset > 0 ? current <= max : current >= max);
	}

	public function next():Float {
		var result = current;
		if (!this.hasNext()) {
			throw "No such element";
		}
		current += offset;
		return result;
	}
}

@:keep
class McIntIterator {
	private var min:Int;
	private var max:Int;
	private var current:Int;
	private var offset:Int;

	public function new(min:Int, max:Int) {
		this.min = min;
		this.max = max;
		this.current = min;
		this.offset = min < max ? 1 : -1;
	}

	public function hasNext():Bool {
		return (this.offset == 1 ? current <= max : current >= max);
	}

	public function next():Int {
		var result = current;
		if (!this.hasNext()) {
			throw "No such element";
		}
		current += offset;
		return result;
	}
}

@:expose("globals")
class Globals {
	public static final loopVariants:Map<Array<Dynamic>, Array<Any>->Any> = [
		[TInt, TInt] => (args:Array<Any>) -> {
			var min:Int = cast args[0];
			var max:Int = cast args[1];
			return cast new McIntIterator(min, max);
		},
		[TFloat, TFloat, TFloat] => (args:Array<Any>) -> {
			var min:Float = args[0];
			var max:Float = args[1];
			var step:Float = args[2];
			return cast new McFloatIterator(min, max, step);
		},
		[TClass(Array)] => (args:Array<Any>) -> {
			return cast new ArrayIterator(args[0]);
		},
		[TObject] => (args:Array<Any>) -> {
			var iterator = Object.entries(args[0]).iterator();
			return iterator;
		},
		[TFunction] => (args) -> {
			var iterator:Void->js.lib.Iterator<Any> = cast args[0];
			return new ArrayIterator(Syntax.code('Array.from({0})', iterator()));
		},
	];

	public static final map:Map<String, Any> = [
		"REPEAT" => (args:haxe.Rest<Any>) -> {
			var argCount = args.length;
			for (overlod => handler in loopVariants) {
				if (overlod.length == argCount) {
					var failure = false;
					for (i in 0...argCount) {
						var t = Type.typeof(args[i]);
						if (!(Type.enumEq(overlod[i], t) || (overlod[i] == TFloat && t == TInt))) {
							failure = true;
							break;
						}
					}
					if (!failure) {
						return handler(args);
					}
				}
			}
			throw "Invalid arguments for REPEAT (" + args.toArray().map(v -> Std.string(Type.typeof(v))).join(", ") + ")";
		},
	];

	public static function set(name:String, value:Any):Void {
		map.set(name, value);
	}

	public static function get(name:String):Any {
		return map.get(name);
	}

	public static function has(name:String):Bool {
		return map.exists(name);
	}

	public static function delete(name:String):Bool {
		return map.remove(name);
	}
}

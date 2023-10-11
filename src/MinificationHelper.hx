package;

import haxe.macro.ExprTools;
import haxe.macro.Context;
import haxe.macro.Expr;

@:autoBuild(MinificationHelper.build())
interface Minified {}

class MinificationHelper {
	public static macro function build():Array<Field> {
		var fields = Context.getBuildFields();
		#if debug
		return fields;
		#end
		#if noMinify
		return fields;
		#end
		var knownFields = new Map<String, Bool>();
		var knownStaticFields = new Map<String, Bool>();
		var parent = Context.getLocalClass().get().superClass;
		trace("--- MinificationHelper ---");
		var newExprs = new Array<Field>();
		while (parent != null) {
			var data = parent.t.get();
			for (field in data.fields.get()) {
				var e = field.expr();
				if (e != null)
					trace(ExprTools.toString(cast e));
				knownFields.set(field.name, true);
			}
			parent = data.superClass;
		}
		trace(knownFields);
		trace(knownStaticFields);
		trace(fields);
		var newFields = new Array<Field>();
		var nameMap = new Map<String, String>();
		var dict = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
		var nextNameId = 0;
		function getName(forName:String) {
			var name = nameMap.get(forName);
			if (name == null) {
				var newName = "";
				var i = nextNameId;
				do {
					newName += dict.charAt(Math.floor(i % dict.length));
					i = Math.floor(i / dict.length);
				} while (i > 0);
				nextNameId++;
				nameMap.set(forName, newName);
				return newName;
			} else {
				return name;
			}
		}
		for (field in fields) {
			if (field.access.indexOf(AExtern) == -1 && field.access.indexOf(AInline) == -1 && field.name != "new") {
				switch (field.kind) {
					case FVar(t, e):
						var origName = field.name;
						var newName = getName(origName);
						// field.kind = FVar(t, e);
						field.name = newName;
						newFields.push(field);
						trace(t);
						newFields.push({
							name: origName,
							access: field.access,
							meta: field.meta,
							kind: FProp("get", "set", t, null),
							pos: field.pos,
						});
						newFields.push({
							kind: FFun({
								args: [
									{
										name: 'value',
										type: t,
										opt: false,
										meta: []
									}
								],
								ret: t,
								expr: {
									expr: EBlock([
										{
											expr: EReturn({
												expr: EBinop(OpAssign, {expr: EConst(CIdent(newName)), pos: field.pos},
													{expr: EConst(CIdent('value')), pos: field.pos}),
												pos: field.pos
											}),
											pos: field.pos,
										}
									]),
									pos: field.pos
								}
							}),
							name: 'set_' + origName,
							access: field.access.concat([AInline, AExtern]),
							meta: field.meta,
							pos: field.pos,
						});
						newFields.push({
							kind: FFun({
								args: [],
								ret: t,
								expr: {
									expr: EBlock([
										{
											expr: EReturn({
												expr: EConst(CIdent(field.name)),
												pos: field.pos
											}),
											pos: field.pos,
										}
									]),
									pos: field.pos
								}
							}),
							name: 'get_' + origName,
							access: field.access.concat([AInline, AExtern]),
							meta: field.meta,
							pos: field.pos,
						});
					case FProp(get, set, t, e):
						var origName = field.name;
						var newName = getName(origName);
						field.kind = FProp(get, set, t, e);
						field.name = newName;
						newFields.push(field);
						newFields.push({
							name: field.name,
							access: field.access,
							meta: field.meta,
							kind: FProp("get", "set", t, e),
							pos: Context.currentPos(),
						});
						if (set != "null")
							newFields.push({
								kind: FFun({
									args: [],
									ret: t,
									expr: {
										expr: EBlock([
											{
												expr: EReturn({
													expr: EConst(CIdent(field.name)),
													pos: Context.currentPos()
												}),
												pos: Context.currentPos(),
											}
										]),
										pos: Context.currentPos()
									}
								}),
								name: 'set_' + origName,
								access: field.access.concat([AInline, AExtern]),
								meta: field.meta,
								pos: Context.currentPos(),
							});
						if (get != "null")
							newFields.push({
								kind: FFun({
									args: [],
									ret: t,
									expr: {
										expr: EBlock([
											{
												expr: EReturn({
													expr: EConst(CIdent(field.name)),
													pos: Context.currentPos()
												}),
												pos: Context.currentPos(),
											}
										]),
										pos: Context.currentPos()
									}
								}),
								name: 'get_' + origName,
								access: field.access.concat([AInline, AExtern]),
								meta: field.meta,
								pos: Context.currentPos(),
							});
					case FFun(f):
						var origName = field.name;
						var newName = getName(origName);
						field.name = newName;
						newFields.push(field);
						newFields.push({
							name: origName,
							access: field.access.contains(AInline) ? field.access : field.access.concat([AInline, AExtern]),
							meta: field.meta,
							kind: FFun({
								args: f.args,
								ret: f.ret,
								expr: {
									pos: field.pos,
									expr: EBlock([
										{
											expr: EReturn({
												expr: ECall({
													expr: EConst(CIdent(newName)),
													pos: field.pos,
												}, f.args.map(function(arg) {
													return {
														expr: EConst(CIdent(arg.name)),
														pos: field.pos,
													};
												})),
												pos: field.pos,
											}),
											pos: field.pos
										}
									])
								},
								params: f.params,
							}),
							pos: Context.currentPos(),
						});
				}
			} else {
				newFields.push(field);
			}
		}
		trace(newFields.map(v -> v.name));
		trace("--------------------------");
		return newFields;
	}
}

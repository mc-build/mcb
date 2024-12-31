package mcl;

import mcl.Tokenizer.PosInfo;
import mcl.error.CompilerError;
import mcl.Compiler.CompilerContext;
import js.Syntax;
import haxe.Json;
import haxe.io.Path;
import js.lib.Set;

class TagManager {
	var tagEntries:Map<String, {
		entries:Set<{value:String, replace:Bool}>,
		replace:Bool
	}> = new Map();

	public function new() {}

	public function ensureTag(tag:String, context:CompilerContext):String {
		var colonIndex = tag.indexOf(':');
		if (colonIndex == -1) {
			tag = context.namespace + ':' + context.path.concat([tag]).join('/');
		}else if(colonIndex != tag.lastIndexOf(":")){
			throw CompilerError.create("Invalid tag name: " + tag, null, context);
		}
		if (!tagEntries.exists(tag)) {
			tagEntries.set(tag, {
				entries: new Set(),
				replace: false
			});
		}
		return tag;
		
	}
	public function addTagEntry(tag:String, entry:String, context:CompilerContext, replace:Bool = false) {
		tag = ensureTag(tag, context);
		tagEntries.get(tag).entries.add({value: entry, replace: replace});
	}

	public function setTagReplace(tag:String, context:CompilerContext, replace:Bool) {
		tag = ensureTag(tag, context);
		tagEntries.get(tag).replace = replace;
	}

	public function writeTagFiles(compiler:Compiler) {
		for (k => v in tagEntries) {
			var segments = k.split(':');
			if (segments.length != 2) {}
			var namespace = segments[0];
			var tag = segments[1];
			var tagPath = Path.join([
				'data',
				namespace,
				'tags',
				compiler.config.features.useFolderRenames48 ? 'function' : "functions",
				tag + '.json'
			]);
			compiler.io.write(tagPath, Json.stringify({
				values: [
					for (entry in v.entries) {
						if (entry.replace) cast entry;
						entry.value;
					}
				],
				replace: v.replace ? true : Syntax.code("undefined")
			}));
		}
		// var basePath = Path.join(['data', 'minecraft', 'tags', 'functions']);
		// var tickPath = Path.join([basePath, 'tick.json']);
		// var loadPath = Path.join([basePath, 'load.json']);
		// if (tickFunctionEntries.size > 0)
		// 	compiler.io.write(tickPath, Json.stringify({values: [for (k in tickFunctionEntries) k]}));
		// if (loadFunctionEntries.size > 0)
		// 	compiler.io.write(loadPath, Json.stringify({values: [for (k in loadFunctionEntries) k]}));
	}
}

package mcl;

import sys.io.File;
import mcl.Compiler.ErrorUtil;
import mcl.Parser.Errors;
import mcl.Tokenizer.PosInfo;
import mcl.Compiler.McTemplate;
import sys.FileSystem;
import haxe.io.Path;
import mcl.Compiler.McFile;

class LibStore {
	var libDir:String;
	var loadedLibs:Map<String, Map<String, McFile>> = new Map<String, Map<String, McFile>>();

	public function new(dir:String) {
		libDir = dir;
	}

	public function lookup(id:String, pos:PosInfo, compiler:Compiler):McFile {
		if (loadedLibs.exists(id)) {
			return loadedLibs.get(id).get('mcblib/${id}.mcbt');
		}
		var p = Path.join([libDir, id]);
		if (FileSystem.exists(p)) {
			return loadLib(id, p, compiler, pos);
		}
		throw ErrorUtil.format('Library not found: $id', pos);
	}

	public function getFilesInDirectory(dir:String):Array<String> {
		var files = FileSystem.readDirectory(dir);
		var result = [];
		for (f in files) {
			var p = Path.join([dir, f]);
			if (FileSystem.isDirectory(p)) {
				result = result.concat(getFilesInDirectory(p));
			} else {
				result.push(p);
			}
		}
		return result;
	}

	function loadLib(id:String, p:String, compiler:Compiler, pos:PosInfo) {
		// because this is a library, we require everything to be in the src/mcblib folder
		var baseDir = Path.join([p, 'src', 'mcblib']);
		var srcDir = Path.join([p, 'src']);
		if (!FileSystem.exists(baseDir)) {
			throw 'Library $id does not have a src/mcblib folder';
		}
		var c = new Compiler(p);
		var files = getFilesInDirectory(baseDir);
		var result = new Map<String, McFile>();
		for (f in files) {
			var ext = Path.extension(f);
			if (ext != "mbt" && ext != "mcbt")
				continue;

			var tokens = Tokenizer.tokenize(File.getContent(f), f);
			var ast = ext == 'mcb' ? Parser.parseMcbFile(tokens) : Parser.parseMcbtFile(tokens);
			var mcFile = new McFile(f, ast);
			mcFile.setup(compiler);
			var finalPath = f.substr(srcDir.length + 1);
			mcFile.name = finalPath;
			result.set(finalPath, mcFile);
		}
		loadedLibs.set(id, result);
		return result.get('mcblib/$id.mcbt');
	}
}

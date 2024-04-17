package;

import haxe.io.Bytes;
import haxe.crypto.Sha1;
import haxe.Resource;
import js.Syntax;
import sys.FileSystem;
import haxe.io.Path;
import sys.io.File;

interface Io {
	public function write(path:String, content:String):Void;
	public function cleanup():Void;
	public function finished():Bool;
	// #if CLI
	public function reportFilesRemoved(oldFiles:Map<String, String>):Array<String>;
	public function reportFilesAdded(oldFiles:Map<String, String>):Array<String>;
	public function reportFilesChanged(oldFiles:Map<String, String>):Array<String>;
	public function reportFileMetadata():Map<String, String>;
	// #end
}

@:expose("io.RevertTracker")
class RevertTracker {
	private var filesTracked:Map<String, Bytes> = new Map();

	public function new() {}

	public function track(path:String) {
		if (FileSystem.exists(path)) {
			filesTracked.set(path, File.getBytes(path));
		} else {
			filesTracked.set(path, null);
		}
	}

	public function revert() {
		for (k => v in filesTracked) {
			if (v == null) {
				FileSystem.deleteFile(k);
			} else {
				FileSystem.createDirectory(Path.directory(k));
				File.saveBytes(k, v);
			}
		}
		filesTracked = new Map();
	}
}

@:expose("io.SyncIo")
class SyncIo implements Io {
	// #if CLI
	private var fileData:Map<String, String> = new Map<String, String>();

	public var revertMap = new RevertTracker();

	public function reportFilesRemoved(oldFiles:Map<String, String>) {
		return [
			for (file in oldFiles.keys()) {
				if (!fileData.exists(file))
					file;
			}
		];
	}

	public function reportFilesAdded(oldFiles:Map<String, String>) {
		return [
			for (file in fileData.keys()) {
				if (!oldFiles.exists(file))
					file;
			}
		];
	}

	public function reportFilesChanged(oldFiles:Map<String, String>) {
		return [
			for (file in fileData.keys()) {
				if (oldFiles.exists(file) && oldFiles.get(file) != fileData.get(file))
					file;
			}
		];
	}

	public function reportFileMetadata():Map<String, String> {
		return fileData;
	}

	// #end

	public function new() {}

	private var existingDirectories:Map<String, Bool> = new Map<String, Bool>();

	public function write(path:String, content:String):Void {
		// #if CLI
		fileData.set(path, Sha1.encode(content));
		revertMap.track(path);
		// #end
		var dir = Path.directory(path);
		if (!existingDirectories.exists(dir)) {
			FileSystem.createDirectory(dir);
			existingDirectories.set(dir, true);
		}
		File.saveContent(path, content);
	}

	public function cleanup() {}

	public function finished() {
		return true;
	}
}

typedef IoEntry = {
	var p:String;
	var c:String;
};

@:expose("io.ThreadedIo")
class ThreadedIo implements Io {
	var enableLog:Bool = false;
	var proc:Any;
	var thread:Dynamic;

	var queue:Array<IoEntry> = [];

	// #if CLI
	var fileData:Map<String, String> = new Map<String, String>();

	public function reportFilesRemoved(oldFiles:Map<String, String>) {
		return [for (file in oldFiles.keys()) if (!fileData.exists(file)) file];
	}

	public function reportFilesAdded(oldFiles:Map<String, String>) {
		return [for (file in fileData.keys()) if (!oldFiles.exists(file)) file];
	}

	public function reportFilesChanged(oldFiles:Map<String, String>) {
		return [
			for (file in fileData.keys())
				if (oldFiles.exists(file) && oldFiles.get(file) != fileData.get(file)) file
		];
	}

	public function reportFileMetadata():Map<String, String> {
		return fileData;
	}

	// #end

	private function log(msg:String) {
		if (enableLog)
			trace('[ThreadedIo | ${Sys.cpuTime()}] ${msg}');
	}

	var done:Bool = false;
	var pending:Bool = false;
	var terminated:Bool = false;

	public function new() {
		Syntax.code("{0} || ({0} = require('node:worker_threads'));", proc);
		Syntax.code("{0} = new {1}.Worker({2},{name:'IoWorker',eval:true,workerData:{3}});", thread, proc, Resource.getString("io-worker"), {
			enableLog: false
		});
		thread.on('error', (error) -> {
			log('Worker error: ${error}');
			terminated = true;
			throw error;
		});
		thread.on('exit', (code) -> {
			// if (code != 0)
			// 	throw 'Worker stopped with exit code ${code}';
			log('Worker stopped with exit code ${code}');
			terminated = true;
		});
		thread.on('message', () -> {
			flush();
		});
	}

	private function flush() {
		log('flush');
		if (queue.length == 0) {
			if (!done) {
				pending = false;
			} else {
				log("Terminating worker thread");
				thread.terminate();
			}
			return;
		}
		var packet = queue;
		queue = [];
		pending = true;
		log('Posting ${packet.length} entries to worker thread');
		thread.postMessage(packet);
	}

	public function write(path:String, content:String):Void {
		// #if CLI
		fileData.set(path, Sha1.encode(content));
		// #end
		log('write ${path}');
		if (done)
			throw 'Cannot write after cleanup()';
		queue.push({p: path, c: content});
		if (!pending) {
			flush();
		}
	};

	public function cleanup():Void {
		log('cleanup');
		done = true;
		if (!pending) {
			flush();
		}
	};

	public function finished() {
		return terminated;
	}
}

@:expose("io.MultiThreadIo")
class MultiThreadIo implements Io {
	var threads:Array<ThreadedIo> = [];
	var idx:Int = 0;
	var mask:Int;

	var fileData:Map<String, String> = new Map<String, String>();

	// #if CLI
	public function reportFilesRemoved(oldFiles:Map<String, String>) {
		var result:Array<String> = [];
		var files = reportFileMetadata();

		for (file in oldFiles.keys()) {
			if (!files.exists(file)) {
				result.push(file);
			}
		}

		return result;
	}

	public function reportFilesAdded(oldFiles:Map<String, String>) {
		var files = reportFileMetadata();
		var result:Array<String> = [];
		for (file in files.keys()) {
			if (!oldFiles.exists(file)) {
				result.push(file);
			}
		}
		return result;
	}

	public function reportFilesChanged(oldFiles:Map<String, String>) {
		var data = reportFileMetadata();
		var result:Array<String> = [];
		for (file in data.keys()) {
			if (oldFiles.exists(file) && oldFiles.get(file) != data.get(file)) {
				result.push(file);
			}
		}
		return result;
	}

	public function reportFileMetadata():Map<String, String> {
		for (t in threads) {
			for (file in t.reportFileMetadata().keys()) {
				fileData.set(file, t.reportFileMetadata().get(file));
			}
		}
		return fileData;
	}

	// #end

	private inline static function isPowerOfTwo(x:Int):Bool {
		return (x & (x - 1)) == 0;
	}

	public function new(count:Int) {
		if (!isPowerOfTwo(count)) {
			throw 'Thread count must be a power of two';
		}
		this.mask = count - 1;
		for (i in 0...count) {
			threads.push(new ThreadedIo());
		}
	}

	public function cleanup():Void {
		for (t in threads) {
			t.cleanup();
		}
	}

	public function write(path:String, content:String):Void {
		threads[idx++ & mask].write(path, content);
	}

	public function finished() {
		for (t in threads) {
			if (!t.finished())
				return false;
		}
		return true;
	}
}

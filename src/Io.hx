package;

import haxe.Resource;
import js.Syntax;
import sys.FileSystem;
import haxe.io.Path;
import sys.io.File;

interface Io {
	public function write(path:String, content:String):Void;
	public function cleanup():Void;
	public function finished():Bool;
}

@:expose("io.SyncIo")
class SyncIo implements Io {
	public function new() {}

	private var existingDirectories:Map<String, Bool> = new Map<String, Bool>();

	public function write(path:String, content:String):Void {
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

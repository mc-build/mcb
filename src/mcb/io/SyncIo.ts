import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import type { IoLike } from "../../mcl/Config";

export class RevertTracker {
	private readonly files = new Map<string, string | null>();

	track(filePath: string): void {
		if (fs.existsSync(filePath)) {
			this.files.set(filePath, fs.readFileSync(filePath, "utf8"));
		} else {
			this.files.set(filePath, null);
		}
	}

	revert(): void {
		for (const [filePath, contents] of this.files.entries()) {
			if (contents === null) {
				if (fs.existsSync(filePath)) {
					fs.rmSync(filePath, { force: true });
				}
				continue;
			}

			fs.mkdirSync(path.dirname(filePath), { recursive: true });
			fs.writeFileSync(filePath, contents, "utf8");
		}

		this.files.clear();
	}
}

export class SyncIo implements IoLike {
	private fileData: Map<string, string> = new Map();
	readonly revertTracker = new RevertTracker();

	write(filePath: string, content: string): void {
		this.fileData.set(filePath, this.hash(content));
		this.revertTracker.track(filePath);
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, content, "utf8");
	}

	cleanup(): void {}

	finished(): boolean {
		return true;
	}

	reportFilesRemoved(oldFiles: Map<string, string>): string[] {
		const result: string[] = [];
		for (const file of oldFiles.keys()) {
			if (!this.fileData.has(file)) {
				result.push(file);
			}
		}
		return result;
	}

	reportFilesAdded(oldFiles: Map<string, string>): string[] {
		const result: string[] = [];
		for (const file of this.fileData.keys()) {
			if (!oldFiles.has(file)) {
				result.push(file);
			}
		}
		return result;
	}

	reportFilesChanged(oldFiles: Map<string, string>): string[] {
		const result: string[] = [];
		for (const [file, hash] of this.fileData.entries()) {
			if (oldFiles.has(file) && oldFiles.get(file) !== hash) {
				result.push(file);
			}
		}
		return result;
	}

	reportFileMetadata(): Map<string, string> {
		return new Map(this.fileData);
	}

	reset(): void {
		this.fileData = new Map();
	}

	private hash(content: string): string {
		return createHash("sha1").update(content, "utf8").digest("hex");
	}
}

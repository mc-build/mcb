import fs from "node:fs";
import path from "node:path";
import { FeatureFlags, FeatureFlagOverrides } from "./FeatureFlags";
import { Logger } from "../mcb/Logger";

export interface UserConfig {
	libDir?: string | null;
	generatedDirName?: string | null;
	internalScoreboardName?: string | null;
	eqVarScoreboardName?: string | null;
	eqConstScoreboardName?: string | null;
	header?: string | null;
	ioThreadCount?: number | null;
	setup?: ((config: Config) => void) | null;
	dontEmitComments?: boolean | null;
	formatVersion?: number | null;
	features?: FeatureFlagOverrides;
}

export interface IoLike {
	write(path: string, content: string): void;
	cleanup(): void;
	finished(): boolean;
	reportFilesRemoved?(oldFiles: Map<string, string>): string[];
	reportFilesAdded?(oldFiles: Map<string, string>): string[];
	reportFilesChanged?(oldFiles: Map<string, string>): string[];
	reportFileMetadata?(): Map<string, string>;
}

export class EventDispatcher<TEvent> {
	private subscribers: Array<(event: TEvent) => void | Promise<void>> = [];

	subscribe(callback: (event: TEvent) => void | Promise<void>): void {
		this.subscribers.push(callback);
	}

	async dispatch(event: TEvent): Promise<void> {
		await Promise.all(this.subscribers.map((subscriber) => subscriber(event)));
	}
}

export type PreBuildEvent = Record<string, never>;
export interface PostBuildEvent {
	success: boolean;
}

export class ConfigEvents {
	readonly onPreBuild = new EventDispatcher<PreBuildEvent>();
	readonly onPostBuild = new EventDispatcher<PostBuildEvent>();
}

export class Config {
	libDir: string;
	events: ConfigEvents;
	generatedDirName: string;
	internalScoreboardName: string;
	io: IoLike | null = null;
	eqVarScoreboardName = "mcb.eq.var";
	eqConstScoreboardName = "mcb.eq.const";
	dontEmitComments = false;
	formatVersion = 1;
	header = "# Generated with MC-Build\n";
	readonly features = new FeatureFlags();

	private constructor() {
		this.libDir = process.cwd();
		this.events = new ConfigEvents();
		this.generatedDirName = "zzz";
		this.internalScoreboardName = "mcb.internal";
	}

	static create(base: UserConfig, projectDir: string = process.cwd()): Config {
		const config = new Config();

		if (base.libDir) config.libDir = base.libDir;
		if (base.generatedDirName) config.generatedDirName = base.generatedDirName;
		if (base.internalScoreboardName)
			config.internalScoreboardName = base.internalScoreboardName;
		if (base.eqConstScoreboardName)
			config.eqConstScoreboardName = base.eqConstScoreboardName;
		if (base.eqVarScoreboardName)
			config.eqVarScoreboardName = base.eqVarScoreboardName;
		if (typeof base.dontEmitComments === "boolean")
			config.dontEmitComments = base.dontEmitComments;
		if (base.header) config.header = base.header;

		if (typeof base.formatVersion === "number") {
			config.formatVersion = base.formatVersion;
		} else {
			// Try to read format version from pack.mcmeta
			const packMetaPath = path.join(projectDir, "pack.mcmeta");

			if (!fs.existsSync(packMetaPath)) {
				Logger.error(
					`Could not determine pack format version: no pack.mcmeta file found at "${packMetaPath}". Please specify formatVersion in the config or add a pack.mcmeta file.`,
				);
				process.exit(21);
			}

			let content: string;
			try {
				content = fs.readFileSync(packMetaPath, "utf8");
			} catch (error) {
				Logger.error(
					`Could not determine pack format version: failed to read "${packMetaPath}": ${error instanceof Error ? error.message : String(error)}`,
				);
				process.exit(21);
			}

			let json: unknown;
			try {
				json = JSON.parse(content);
			} catch (error) {
				Logger.error(
					`Could not determine pack format version: "${packMetaPath}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
				);
				process.exit(21);
			}

			const packFormat = (json as { pack?: { pack_format?: unknown } })?.pack
				?.pack_format;
			if (typeof packFormat === "number") {
				config.formatVersion = packFormat;
			} else {
				Logger.error(
					`Could not determine pack format version: "${packMetaPath}" has no numeric "pack.pack_format" field. Please specify formatVersion in the config or fix the pack.mcmeta file.`,
				);
				process.exit(21);
			}
		}

		if (base.features) {
			config.features.apply(config.formatVersion, base.features);
		} else {
			config.features.apply(config.formatVersion, null);
		}

		if (base.setup) {
			base.setup(config);
		}

		return config;
	}
}

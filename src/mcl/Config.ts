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

	static create(base: UserConfig): Config {
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
			try {
				const packMetaPath = path.join(process.cwd(), "pack.mcmeta");
				const content = fs.readFileSync(packMetaPath, "utf8");
				const json = JSON.parse(content);

				if (json?.pack?.pack_format != null) {
					config.formatVersion = json.pack.pack_format;
				} else {
					Logger.error(
						"Could not determine pack format version, please specify it in the config or pack.mcmeta file, if you have a pack.mcmeta file already this may be the result of a parsing error.",
					);
					process.exit(21);
				}
			} catch (error) {
				Logger.error(
					"Could not determine pack format version, please specify it in the config or pack.mcmeta file, if you have a pack.mcmeta file already this may be the result of a parsing error.",
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

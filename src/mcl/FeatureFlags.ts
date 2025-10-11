import { Logger } from "../mcb/Logger";

export type FeatureFlagOverrides = {
  useFolderRenames48?: boolean | null;
  useFolderRenames43?: boolean | null;
} | null;

export class FeatureFlags {
  useFolderRenames48 = false;

  private static readonly flags: Map<number, FeatureFlagOverrides> = new Map([
    [48, { useFolderRenames48: true }],
    [0, { useFolderRenames43: false, useFolderRenames48: false }],
  ]);

  static readonly latestVersionSentinel = 99999;

  static getAvailableVersions(includeLatestSentinel = true): number[] {
    const versions = Array.from(FeatureFlags.flags.keys()).sort((a, b) => a - b);
    if (includeLatestSentinel) {
      versions.push(FeatureFlags.latestVersionSentinel);
    }
    return versions;
  }

  apply(version: number, overrides: FeatureFlagOverrides): void {
    Logger.log(`using pack version ${version}`);
    const ids = Array.from(FeatureFlags.flags.keys()).sort((a, b) => a - b);
    for (const id of ids) {
      if (version < id) {
        return;
      }
      const flag = FeatureFlags.flags.get(id);
      if (flag?.useFolderRenames48 !== undefined && flag.useFolderRenames48 === true) {
        this.useFolderRenames48 = flag.useFolderRenames48;
      }
    }
    if (overrides) {
      if (overrides.useFolderRenames48 !== undefined && overrides.useFolderRenames48 === true) {
        this.useFolderRenames48 = overrides.useFolderRenames48;
      }
    }
    Object.freeze(this);
  }
}

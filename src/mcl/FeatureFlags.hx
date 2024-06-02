package mcl;

import js.lib.Object;

typedef FeatureFlagOverrides = Null<{
	useOldTagFolderNames:Null<Bool>
}>;

class FeatureFlags {
	public function new() {}

	static final flags:Map<Int, FeatureFlagOverrides> = [
		45 => {
			useOldTagFolderNames: false
		},
		0 => {
			useOldTagFolderNames: true
		}
	];

	public var useOldTagFolderNames:Bool = true;

	public function apply(version:Int, overrides:FeatureFlagOverrides) {
		var ids = [for (k => _ in flags) k];
		ids.sort((a, b) -> b - a);

		for (id in ids) {
			if (version > id)
				return;
			var flag = flags[id];
			if (flag.useOldTagFolderNames != null)
				useOldTagFolderNames = flag.useOldTagFolderNames;
		}
		if (overrides != null) {
			if (overrides.useOldTagFolderNames != null)
				useOldTagFolderNames = overrides.useOldTagFolderNames;
		}
		Object.freeze(this);
	}
}

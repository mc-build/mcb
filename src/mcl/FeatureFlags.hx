package mcl;

import js.lib.Object;

typedef FeatureFlagOverrides = Null<{
	?useFolderRenames45:Null<Bool>,
	?useFolderRenames43:Null<Bool>,
}>;

class FeatureFlags {
	public function new() {}

	static final flags:Map<Int, FeatureFlagOverrides> = [
		45 => {
			useFolderRenames45: true
		},
		43 => {
			useFolderRenames43: true
		},
		0 => {
			useFolderRenames43: false,
			useFolderRenames45: false
		}
	];

	public var useFolderRenames45:Bool = false;
	public var useFolderRenames43:Bool = false;

	public function apply(version:Int, overrides:FeatureFlagOverrides) {
		var ids = [for (k => _ in flags) k];
		ids.sort((a, b) -> a - b);

		for (id in ids) {
			if (version < id)
				return;
			var flag = flags[id];
			if (flag.useFolderRenames43 != null)
				useFolderRenames43 = flag.useFolderRenames43;
			if (flag.useFolderRenames45 != null)
				useFolderRenames45 = flag.useFolderRenames45;
		}
		if (overrides != null) {
			if (overrides.useFolderRenames43 != null)
				useFolderRenames43 = overrides.useFolderRenames43;
			if (overrides.useFolderRenames45 != null)
				useFolderRenames45 = overrides.useFolderRenames45;
		}
		Object.freeze(this);
	}
}

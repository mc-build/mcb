package mcl;

#if !macro
import js.lib.Object;
#end

typedef FeatureFlagOverrides = Null<{
	?useFolderRenames48:Null<Bool>,
	?useFolderRenames43:Null<Bool>,
}>;

class FeatureFlags {
	public function new() {}

	public static final flags:Map<Int, FeatureFlagOverrides> = [
		48 => {
			useFolderRenames48: true
		},
		0 => {
			useFolderRenames43: false,
			useFolderRenames48: false
		}
	];

	public var useFolderRenames48:Bool = false;

	public function apply(version:Int, overrides:FeatureFlagOverrides) {
		var ids = [for (k => _ in flags) k];
		ids.sort((a, b) -> a - b);

		for (id in ids) {
			if (version < id)
				return;
			var flag = flags[id];
			if (flag.useFolderRenames48 != null)
				useFolderRenames48 = flag.useFolderRenames48;
		}
		if (overrides != null) {
			if (overrides.useFolderRenames48 != null)
				useFolderRenames48 = overrides.useFolderRenames48;
		}
		#if !macro
		Object.freeze(this);
		#end
	}
}

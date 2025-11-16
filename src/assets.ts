/**
 * Re-export assets plugin from @b9g/assets/plugin
 *
 * This module provides backwards compatibility for the CLI.
 * The canonical location is now @b9g/assets/plugin.
 */

export {
	assetsPlugin,
	type AssetsPluginConfig as AssetsConfig,
	default,
} from "@b9g/assets/plugin";

export {
	type AssetManifest,
	type AssetManifestEntry,
} from "@b9g/assets";

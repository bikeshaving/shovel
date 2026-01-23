/**
 * Platform module loader for the Shovel CLI
 *
 * Loads platform modules (function-based) instead of instantiating classes.
 * This enables tree-shaking - dev dependencies like Miniflare never end up
 * in production bundles.
 */

import type {PlatformModule} from "@b9g/platform/module";

/**
 * Load a platform module by name.
 *
 * Platform modules export functions, not classes:
 * - name: string
 * - getEntryPoints(userPath, mode): EntryPoints
 * - getESBuildConfig(): ESBuildConfig
 * - getDefaults(): PlatformDefaults
 * - createDevServer(options): Promise<DevServer>
 */
export async function loadPlatformModule(
	platformName: string,
): Promise<PlatformModule> {
	switch (platformName) {
		case "node": {
			const module = await import("@b9g/platform-node/platform");
			return module as PlatformModule;
		}

		case "bun": {
			const module = await import("@b9g/platform-bun/platform");
			return module as PlatformModule;
		}

		case "cloudflare": {
			const module = await import("@b9g/platform-cloudflare/platform");
			return module as PlatformModule;
		}

		default:
			throw new Error(
				`Unknown platform: ${platformName}. Valid platforms: node, bun, cloudflare`,
			);
	}
}

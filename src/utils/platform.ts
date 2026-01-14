/**
 * Platform factory for the Shovel CLI
 *
 * Creates platform instances based on name. This lives in the CLI
 * rather than @b9g/platform to avoid circular dependencies.
 */

import type {Platform} from "@b9g/platform";

/**
 * Create platform instance based on name
 */
export async function createPlatform(
	platformName: string,
	options: Record<string, unknown> = {},
): Promise<Platform> {
	switch (platformName) {
		case "node": {
			const {default: NodePlatform} = await import("@b9g/platform-node");
			return new NodePlatform(options);
		}

		case "bun": {
			const {default: BunPlatform} = await import("@b9g/platform-bun");
			return new BunPlatform(options);
		}

		case "cloudflare": {
			const {default: CloudflarePlatform} =
				await import("@b9g/platform-cloudflare");
			return new CloudflarePlatform(options);
		}

		default:
			throw new Error(
				`Unknown platform: ${platformName}. Valid platforms: node, bun, cloudflare`,
			);
	}
}

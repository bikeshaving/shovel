/**
 * Platform registry for auto-detection and management
 */

import type {Platform} from "./base-platform.js";
import type {PlatformDetection, PlatformRegistry} from "./detection.js";
import {getBestPlatformDetection} from "./detection.js";

/**
 * Global platform registry
 */
class DefaultPlatformRegistry implements PlatformRegistry {
	private platforms = new Map<string, Platform>();

	register(name: string, platform: Platform): void {
		this.platforms.set(name, platform);
	}

	get(name: string): Platform | undefined {
		return this.platforms.get(name);
	}

	detect(): PlatformDetection {
		return getBestPlatformDetection();
	}

	list(): string[] {
		return Array.from(this.platforms.keys());
	}
}

/**
 * Global platform registry instance
 */
export const platformRegistry = new DefaultPlatformRegistry();

/**
 * Auto-detect and return the appropriate platform
 */
export function detectPlatform(): Platform | null {
	const detection = platformRegistry.detect();

	if (detection.confidence > 0.5) {
		const platform = platformRegistry.get(detection.platform);
		if (platform) {
			return platform;
		}
	}

	return null;
}

/**
 * Get platform by name with error handling
 */
export function getPlatform(name?: string): Platform {
	if (name) {
		const platform = platformRegistry.get(name);
		if (!platform) {
			const available = platformRegistry.list();
			throw new Error(
				`Platform '${name}' not found. Available platforms: ${available.join(", ")}`,
			);
		}
		return platform;
	}

	// Auto-detect platform
	const detected = detectPlatform();
	if (!detected) {
		throw new Error(
			"No platform could be auto-detected. Please register a platform manually or specify a platform name.",
		);
	}

	return detected;
}

/**
 * Get platform with async auto-registration fallback
 */
export async function getPlatformAsync(name?: string): Promise<Platform> {
	if (name) {
		const platform = platformRegistry.get(name);
		if (!platform) {
			const available = platformRegistry.list();
			throw new Error(
				`Platform '${name}' not found. Available platforms: ${available.join(", ")}`,
			);
		}
		return platform;
	}

	// Auto-detect platform
	const detected = detectPlatform();
	if (!detected) {
		// Create default Node.js platform if no platforms are registered
		const NodePlatform = await import("@b9g/platform-node").then(
			(m) => m.default,
		);
		const nodePlatform = new NodePlatform();
		platformRegistry.register("node", nodePlatform);
		return nodePlatform;
	}

	return detected;
}

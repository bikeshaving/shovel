/**
 * Platform detection and creation utilities for the Shovel CLI
 *
 * Smart defaults: detect current runtime for development
 * Override: explicit targeting for deployment
 */

/**
 * Detect the current JavaScript runtime
 */
export function detectRuntime() {
	if (typeof Bun !== "undefined" || process.versions.bun) {
		return "bun";
	}

	if (typeof Deno !== "undefined") {
		return "deno";
	}

	// Default to Node.js
	return "node";
}

/**
 * Detect platform for development (uses current runtime)
 */
export function detectDevelopmentPlatform() {
	const runtime = detectRuntime();

	switch (runtime) {
		case "bun":
			return "bun";
		case "deno":
			return "deno";
		case "node":
		default:
			return "node";
	}
}

/**
 * Get platform name from target flag or detect automatically
 */
export function resolvePlatform(options = {}) {
	// Explicit targeting (for builds/deployment)
	if (options.target) {
		return options.target;
	}

	if (options.platform) {
		return options.platform;
	}

	// Smart default (for development)
	return detectDevelopmentPlatform();
}

/**
 * Create platform instance based on name
 */
export async function createPlatform(platformName, options = {}) {
	switch (platformName) {
		case "node": {
			const {createNodePlatform} = await import("@b9g/platform-node");
			return createNodePlatform(options);
		}

		case "bun": {
			const {createBunPlatform} = await import("@b9g/platform-bun");
			return createBunPlatform(options);
		}

		case "cloudflare":
		case "cf": {
			const {createCloudflarePlatform} = await import(
				"@b9g/platform-cloudflare"
			);
			return createCloudflarePlatform(options);
		}

		default:
			throw new Error(
				`Unknown platform: ${platformName}. Supported platforms: node, bun, cloudflare`,
			);
	}
}

/**
 * Get platform-specific default options
 */
export function getPlatformDefaults(platformName) {
	switch (platformName) {
		case "node":
			return {
				port: 3000,
				hotReload: process.env.NODE_ENV !== "production",
			};

		case "bun":
			return {
				port: 3000,
				hotReload: process.env.NODE_ENV !== "production",
			};

		case "cloudflare":
		case "cf":
			return {
				environment: process.env.CF_ENVIRONMENT || "production",
				hotReload: false, // Not available in Workers
			};

		default:
			return {};
	}
}

/**
 * Display platform info for debugging
 */
export function displayPlatformInfo(platformName) {
	const runtime = detectRuntime();
	const isExplicit = platformName !== detectDevelopmentPlatform();

	console.info(
		`[Shovel] Platform: ${platformName} ${isExplicit ? "(explicit)" : "(detected)"}`,
	);
	console.info(`[Shovel] Runtime: ${runtime}`);

	if (isExplicit && runtime !== platformName) {
		console.info(`[Shovel] Cross-targeting: ${runtime} → ${platformName}`);
	}
}

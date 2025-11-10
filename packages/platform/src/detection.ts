/**
 * Platform detection utilities
 * Centralized logic for detecting JavaScript runtime and deployment platforms
 */

import type {PlatformDetection} from "./types.js";

/**
 * Detect the current JavaScript runtime
 */
export function detectRuntime(): "bun" | "deno" | "node" {
	if (typeof Bun !== "undefined" || process.versions?.bun) {
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
export function detectDevelopmentPlatform(): string {
	const runtime = detectRuntime();

	switch (runtime) {
		case "bun":
			return "bun";
		case "deno":
			return "node"; // Use Node.js platform for Deno for now
		case "node":
		default:
			return "node";
	}
}

/**
 * Comprehensive platform detection with confidence scoring
 */
export function detectPlatforms(): PlatformDetection[] {
	const detections: PlatformDetection[] = [];

	// Check for Bun
	if (typeof Bun !== "undefined") {
		detections.push({
			platform: "bun",
			confidence: 0.9,
			reasons: ["Bun global detected"],
		});
	}

	// Check for Vercel Edge Runtime
	if (typeof EdgeRuntime !== "undefined") {
		detections.push({
			platform: "vercel",
			confidence: 0.9,
			reasons: ["Vercel EdgeRuntime detected"],
		});
	}

	// Check for Deno
	if (typeof Deno !== "undefined") {
		detections.push({
			platform: "deno",
			confidence: 0.9,
			reasons: ["Deno global detected"],
		});
	}

	// Check for Cloudflare Workers
	if (
		typeof caches !== "undefined" &&
		typeof Response !== "undefined" &&
		typeof crypto !== "undefined"
	) {
		// Additional check for Workers-specific globals
		if (
			typeof addEventListener !== "undefined" &&
			typeof fetch !== "undefined"
		) {
			detections.push({
				platform: "cloudflare-workers",
				confidence: 0.8,
				reasons: ["Worker-like environment detected", "Web APIs available"],
			});
		}
	}

	// Check for Node.js (fallback)
	if (
		typeof process !== "undefined" &&
		process.versions &&
		process.versions.node
	) {
		detections.push({
			platform: "node",
			confidence: 0.7,
			reasons: ["Node.js process detected"],
		});
	}

	// Fallback detection
	if (detections.length === 0) {
		detections.push({
			platform: "unknown",
			confidence: 0,
			reasons: ["No platform detected"],
		});
	}

	return detections.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Get the best platform detection
 */
export function getBestPlatformDetection(): PlatformDetection {
	const detections = detectPlatforms();
	return detections[0];
}

/**
 * Resolve platform name from options or auto-detect
 */
export function resolvePlatform(options: {
	platform?: string;
	target?: string;
}): string {
	// Explicit platform takes precedence
	if (options.platform) {
		return options.platform;
	}

	// Target for build/deploy scenarios
	if (options.target) {
		return options.target;
	}

	// Auto-detect for development
	return detectDevelopmentPlatform();
}

/**
 * Create platform instance based on name
 */
export async function createPlatform(
	platformName: string,
	options: any = {},
): Promise<any> {
	switch (platformName) {
		case "node": {
			const modulePath = import.meta.resolve("@b9g/platform-node");
			const NodePlatform = await import(modulePath).then((m) => m.default);
			return new NodePlatform(options);
		}

		case "bun": {
			const modulePath = import.meta.resolve("@b9g/platform-bun");
			const BunPlatform = await import(modulePath).then((m) => m.default);
			return new BunPlatform(options);
		}

		case "cloudflare":
		case "cloudflare-workers":
		case "cf": {
			const modulePath = import.meta.resolve("@b9g/platform-cloudflare");
			const CloudflarePlatform = await import(modulePath).then(
				(m) => m.default,
			);
			return new CloudflarePlatform(options);
		}

		default:
			throw new Error(
				`Unknown platform: ${platformName}. Available platforms: node, bun, cloudflare`,
			);
	}
}

/**
 * Display platform information (for CLI info command)
 */
export function displayPlatformInfo(platformName: string): void {
	const runtime = detectRuntime();
	const detection = getBestPlatformDetection();

	console.info(`🚀 Platform: ${platformName}`);
	console.info(`⚙️  Runtime: ${runtime}`);
	console.info(
		`🔍 Auto-detected: ${detection.platform} (confidence: ${detection.confidence})`,
	);
	console.info(`💡 Reasons: ${detection.reasons.join(", ")}`);
}

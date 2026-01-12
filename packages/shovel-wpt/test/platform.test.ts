/**
 * Platform contract tests
 *
 * Tests that all platform adapters provide the same interface.
 * ServiceWorker tests are skipped - loadServiceWorker requires pre-built
 * worker entries, and that flow is tested end-to-end via develop.test.js
 * and executable.test.js.
 */

import {join} from "path";
import {runPlatformTests} from "../src/runners/platform.js";
import {MemoryCache} from "@b9g/cache/memory";

const fixturesDir = join(import.meta.dir, "fixtures");

// =============================================================================
// Node Platform Tests
// =============================================================================
runPlatformTests("NodePlatform", {
	async createPlatform() {
		const {default: NodePlatform} = await import("@b9g/platform-node");
		return new NodePlatform({
			cwd: fixturesDir,
			config: {
				caches: {
					"test-cache": {impl: MemoryCache},
					"functional-test": {impl: MemoryCache},
					"cache-1": {impl: MemoryCache},
					"cache-2": {impl: MemoryCache},
				},
			},
		});
	},
	skipServiceWorkerTests: true,
	skipServerTests: false,
});

// =============================================================================
// Bun Platform Tests
// =============================================================================
runPlatformTests("BunPlatform", {
	async createPlatform() {
		const {default: BunPlatform} = await import("@b9g/platform-bun");
		return new BunPlatform({
			cwd: fixturesDir,
			config: {
				caches: {
					"test-cache": {impl: MemoryCache},
					"functional-test": {impl: MemoryCache},
					"cache-1": {impl: MemoryCache},
					"cache-2": {impl: MemoryCache},
				},
			},
		});
	},
	skipServiceWorkerTests: true,
	skipServerTests: false,
});

// =============================================================================
// Cloudflare Platform Tests
// =============================================================================
runPlatformTests("CloudflarePlatform", {
	async createPlatform() {
		const {default: CloudflarePlatform} =
			await import("@b9g/platform-cloudflare");
		return new CloudflarePlatform({
			cwd: fixturesDir,
			config: {
				caches: {
					"test-cache": {impl: MemoryCache},
					"functional-test": {impl: MemoryCache},
					"cache-1": {impl: MemoryCache},
					"cache-2": {impl: MemoryCache},
				},
			},
		});
	},
	skipServiceWorkerTests: true,
	skipServerTests: true, // Cloudflare doesn't have a traditional server
});

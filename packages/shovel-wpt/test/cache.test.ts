/**
 * Tests for the cache WPT test runner
 *
 * This file runs the WPT-based cache tests against MemoryCache
 * to verify the test runner works correctly.
 */

import {runCacheTests} from "../src/runners/cache.js";
import {MemoryCache} from "../../cache/src/memory.js";

// Run WPT cache tests against MemoryCache
runCacheTests("MemoryCache", {
	createCache: (name) => new MemoryCache(name),
	cleanup: async () => {
		// MemoryCache doesn't need cleanup - each test gets fresh instance
	},
});

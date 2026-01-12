/* eslint-disable no-restricted-properties -- Tests need process.cwd/env */
/**
 * E2E tests for module bundling verification
 *
 * These tests build and ACTUALLY RUN the bundled output to ensure:
 * - All modules are properly bundled (no dynamic import failures)
 * - Logging sinks are statically imported and work at runtime
 * - Cache/directory providers are properly bundled
 *
 * Unlike build.test.js which only validates output structure,
 * these tests execute the bundle to catch runtime module resolution failures.
 */

import * as FS from "fs/promises";
import {tmpdir} from "os";
import {join} from "path";
import {test, expect} from "bun:test";
import {buildForProduction} from "../src/commands/build.js";
import {loadConfig} from "../src/utils/config.js";
import {spawn} from "child_process";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["test", "e2e-bundling"]);

const TIMEOUT = 15000; // 15 second timeout for build + run

// Helper to create temporary directory with all necessary files
async function createTestProject(files) {
	const projectDir = join(
		tmpdir(),
		`shovel-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await FS.mkdir(projectDir, {recursive: true});

	for (const [filename, content] of Object.entries(files)) {
		const filePath = join(projectDir, filename);
		await FS.mkdir(join(filePath, ".."), {recursive: true});
		await FS.writeFile(filePath, content, "utf8");
	}

	// Symlink node_modules from workspace root
	const nodeModulesSource = join(process.cwd(), "node_modules");
	const nodeModulesLink = join(projectDir, "node_modules");
	await FS.symlink(nodeModulesSource, nodeModulesLink, "dir");

	return projectDir;
}

// Helper to clean up
async function cleanup(paths) {
	for (const path of paths) {
		try {
			await FS.rm(path, {recursive: true, force: true});
		} catch (err) {
			logger.debug`Cleanup of ${path} failed: ${err}`;
		}
	}
}

// Helper to run the built bundle and capture output
async function runBundle(serverDir, timeoutMs = 3000) {
	return new Promise((resolve, reject) => {
		const indexPath = join(serverDir, "index.js");
		const child = spawn("node", [indexPath], {
			cwd: serverDir,
			stdio: ["pipe", "pipe", "pipe"],
			env: {
				...process.env,
				// Set PORT to avoid conflicts
				PORT: "0",
				// Ensure clean environment
				NODE_ENV: "test",
			},
		});

		let stdout = "";
		let stderr = "";
		let exited = false;

		child.stdout.on("data", (data) => {
			stdout += data.toString();
		});

		child.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		const timer = setTimeout(() => {
			if (!exited) {
				child.kill("SIGTERM");
				resolve({stdout, stderr, timedOut: true, exitCode: null});
			}
		}, timeoutMs);

		child.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});

		child.on("exit", (code) => {
			exited = true;
			clearTimeout(timer);
			resolve({stdout, stderr, timedOut: false, exitCode: code});
		});
	});
}

// ======================
// BASIC MODULE BUNDLING E2E
// ======================

test(
	"E2E: basic ServiceWorker builds and runs",
	async () => {
		const cleanup_paths = [];

		try {
			const projectDir = await createTestProject({
				"app.js": `
console.log("E2E_STARTUP_MARKER");

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Hello from E2E test"));
});

console.log("E2E_READY_MARKER");
				`,
				"shovel.json": JSON.stringify({
					port: 3000,
					workers: 1,
				}),
			});
			cleanup_paths.push(projectDir);

			const outDir = join(projectDir, "dist");

			// Build
			const originalCwd = process.cwd();
			process.chdir(projectDir);
			try {
				await buildForProduction({
					entrypoint: join(projectDir, "app.js"),
					outDir,
					verbose: false,
					platform: "node",
				});
			} finally {
				process.chdir(originalCwd);
			}

			// Run the bundle
			const result = await runBundle(join(outDir, "server"));

			// Verify it started without module errors
			expect(result.stderr).not.toContain("Cannot find module");
			expect(result.stderr).not.toContain("Could not resolve");
			expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
			expect(result.stdout).toContain("E2E_STARTUP_MARKER");
			expect(result.stdout).toContain("E2E_READY_MARKER");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

// ======================
// LOGGING SINK BUNDLING E2E
// ======================

test(
	"E2E: console logging sink is bundled and works",
	async () => {
		const cleanup_paths = [];

		try {
			const projectDir = await createTestProject({
				"app.js": `
console.log("LOGGING_TEST_START");

// Access the logger via self.loggers
self.addEventListener("install", () => {
	console.log("INSTALL_EVENT_FIRED");
});

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("OK"));
});

console.log("LOGGING_TEST_READY");
				`,
				"shovel.json": JSON.stringify({
					port: 3000,
					workers: 1,
					logging: {
						sinks: {
							console: {module: "@logtape/logtape", export: "getConsoleSink"},
						},
						loggers: [{category: [], level: "debug", sinks: ["console"]}],
					},
				}),
			});
			cleanup_paths.push(projectDir);

			const outDir = join(projectDir, "dist");

			const originalCwd = process.cwd();
			process.chdir(projectDir);
			try {
				await buildForProduction({
					entrypoint: join(projectDir, "app.js"),
					outDir,
					verbose: false,
					platform: "node",
				});
			} finally {
				process.chdir(originalCwd);
			}

			// Verify the bundle contains the static import for console sink
			const indexContent = await FS.readFile(
				join(outDir, "server", "index.js"),
				"utf8",
			);
			// Should contain bundled getConsoleSink (the function, not an import statement since it's bundled)
			expect(indexContent).toContain("getConsoleSink");

			// Run the bundle
			const result = await runBundle(join(outDir, "server"));

			// Should start without module errors
			expect(result.stderr).not.toContain("Cannot find module");
			expect(result.stderr).not.toContain("Could not resolve");
			expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
			expect(result.stdout).toContain("LOGGING_TEST_START");
			expect(result.stdout).toContain("LOGGING_TEST_READY");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

test(
	"E2E: multiple logging sinks are bundled",
	async () => {
		const cleanup_paths = [];

		try {
			const projectDir = await createTestProject({
				"app.js": `
console.log("MULTI_SINK_START");

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("OK"));
});

console.log("MULTI_SINK_READY");
				`,
				"shovel.json": JSON.stringify({
					port: 3000,
					workers: 1,
					logging: {
						sinks: {
							console: {module: "@logtape/logtape", export: "getConsoleSink"},
							// File sink requires path - will be bundled even if not used
							appLog: {
								module: "@logtape/file",
								export: "getFileSink",
								path: "/tmp/shovel-e2e-test.log",
							},
						},
						loggers: [
							{category: [], level: "info", sinks: ["console", "appLog"]},
						],
					},
				}),
			});
			cleanup_paths.push(projectDir);

			const outDir = join(projectDir, "dist");

			const originalCwd = process.cwd();
			process.chdir(projectDir);
			try {
				await buildForProduction({
					entrypoint: join(projectDir, "app.js"),
					outDir,
					verbose: false,
					platform: "node",
				});
			} finally {
				process.chdir(originalCwd);
			}

			// Verify the bundle contains both sink functions
			const indexContent = await FS.readFile(
				join(outDir, "server", "index.js"),
				"utf8",
			);
			expect(indexContent).toContain("getConsoleSink");
			expect(indexContent).toContain("getFileSink");

			// Run the bundle
			const result = await runBundle(join(outDir, "server"));

			// Should start without module errors
			expect(result.stderr).not.toContain("Cannot find module");
			expect(result.stderr).not.toContain("Could not resolve");
			expect(result.stderr).not.toContain("dynamic import");
			expect(result.stdout).toContain("MULTI_SINK_START");
			expect(result.stdout).toContain("MULTI_SINK_READY");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

// ======================
// CACHE PROVIDER BUNDLING E2E
// ======================

test(
	"E2E: memory cache provider is bundled",
	async () => {
		const cleanup_paths = [];

		try {
			const projectDir = await createTestProject({
				"app.js": `
console.log("CACHE_TEST_START");

self.addEventListener("fetch", async (event) => {
	const cache = await caches.open("test");
	event.respondWith(new Response("OK"));
});

console.log("CACHE_TEST_READY");
				`,
				"shovel.json": JSON.stringify({
					port: 3000,
					workers: 1,
					caches: {
						"*": {
							module: "@b9g/cache/memory",
							export: "MemoryCache",
							maxEntries: 100,
						},
					},
				}),
			});
			cleanup_paths.push(projectDir);

			const outDir = join(projectDir, "dist");

			const originalCwd = process.cwd();
			process.chdir(projectDir);
			try {
				await buildForProduction({
					entrypoint: join(projectDir, "app.js"),
					outDir,
					verbose: false,
					platform: "node",
				});
			} finally {
				process.chdir(originalCwd);
			}

			// Run the bundle
			const result = await runBundle(join(outDir, "server"));

			// Should start without module errors
			expect(result.stderr).not.toContain("Cannot find module");
			expect(result.stderr).not.toContain("Could not resolve");
			expect(result.stdout).toContain("CACHE_TEST_START");
			expect(result.stdout).toContain("CACHE_TEST_READY");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

// ======================
// DIRECTORY PROVIDER BUNDLING E2E
// ======================

test(
	"E2E: memory directory provider is bundled",
	async () => {
		const cleanup_paths = [];

		try {
			const projectDir = await createTestProject({
				"app.js": `
console.log("DIRECTORY_TEST_START");

self.addEventListener("fetch", async (event) => {
	const dir = await directories.open("uploads");
	event.respondWith(new Response("OK"));
});

console.log("DIRECTORY_TEST_READY");
				`,
				"shovel.json": JSON.stringify({
					port: 3000,
					workers: 1,
					directories: {
						uploads: {
							module: "@b9g/filesystem/memory",
							export: "MemoryDirectory",
						},
					},
				}),
			});
			cleanup_paths.push(projectDir);

			const outDir = join(projectDir, "dist");

			const originalCwd = process.cwd();
			process.chdir(projectDir);
			try {
				await buildForProduction({
					entrypoint: join(projectDir, "app.js"),
					outDir,
					verbose: false,
					platform: "node",
				});
			} finally {
				process.chdir(originalCwd);
			}

			// Run the bundle
			const result = await runBundle(join(outDir, "server"));

			// Should start without module errors
			expect(result.stderr).not.toContain("Cannot find module");
			expect(result.stderr).not.toContain("Could not resolve");
			expect(result.stdout).toContain("DIRECTORY_TEST_START");
			expect(result.stdout).toContain("DIRECTORY_TEST_READY");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

// ======================
// COMBINED PROVIDERS E2E
// ======================

test(
	"E2E: all providers bundled together work at runtime",
	async () => {
		const cleanup_paths = [];

		try {
			const projectDir = await createTestProject({
				"app.js": `
console.log("FULL_E2E_START");

self.addEventListener("install", () => {
	console.log("FULL_E2E_INSTALL");
});

self.addEventListener("fetch", async (event) => {
	try {
		// Test caches access
		const cache = await caches.open("test");

		// Test directories access
		const dir = await directories.open("uploads");

		// Test loggers access
		const logger = await loggers.open("app");
		logger.info("Full E2E test running");

		event.respondWith(new Response("All systems operational"));
	} catch (error) {
		console.error("E2E_ERROR:", error.message);
		event.respondWith(new Response("Error: " + error.message, {status: 500}));
	}
});

console.log("FULL_E2E_READY");
				`,
				"shovel.json": JSON.stringify({
					port: 3000,
					workers: 1,
					logging: {
						sinks: {
							console: {module: "@logtape/logtape", export: "getConsoleSink"},
						},
						loggers: [{category: [], level: "debug", sinks: ["console"]}],
					},
					caches: {
						"*": {
							module: "@b9g/cache/memory",
							export: "MemoryCache",
							maxEntries: 100,
						},
					},
					directories: {
						uploads: {
							module: "@b9g/filesystem/memory",
							export: "MemoryDirectory",
						},
					},
				}),
			});
			cleanup_paths.push(projectDir);

			const outDir = join(projectDir, "dist");

			const originalCwd = process.cwd();
			process.chdir(projectDir);
			try {
				await buildForProduction({
					entrypoint: join(projectDir, "app.js"),
					outDir,
					verbose: false,
					platform: "node",
				});
			} finally {
				process.chdir(originalCwd);
			}

			// Verify the bundle structure
			const indexContent = await FS.readFile(
				join(outDir, "server", "index.js"),
				"utf8",
			);

			// Should not have any require() or dynamic import() that would fail
			// All modules should be statically bundled
			expect(indexContent).not.toMatch(/require\s*\(\s*[^)]+\)/);

			// Run the bundle
			const result = await runBundle(join(outDir, "server"));

			// Should start without ANY module errors
			expect(result.stderr).not.toContain("Cannot find module");
			expect(result.stderr).not.toContain("Could not resolve");
			expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
			expect(result.stderr).not.toContain("dynamic import");
			expect(result.stderr).not.toContain("E2E_ERROR:");

			// Should have all startup markers
			expect(result.stdout).toContain("FULL_E2E_START");
			expect(result.stdout).toContain("FULL_E2E_READY");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

// ======================
// REGRESSION TEST: Bundle Runs Successfully with All Providers
// ======================

test(
	"E2E: production bundle runs without module resolution errors",
	async () => {
		const cleanup_paths = [];

		try {
			const projectDir = await createTestProject({
				"app.js": `
console.log("FULL_PROVIDER_TEST_START");

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("OK"));
});

console.log("FULL_PROVIDER_TEST_READY");
				`,
				"shovel.json": JSON.stringify({
					port: 3000,
					workers: 1,
					logging: {
						sinks: {
							console: {module: "@logtape/logtape", export: "getConsoleSink"},
							file: {
								module: "@logtape/file",
								export: "getFileSink",
								path: "/tmp/test.log",
							},
						},
						loggers: [
							{category: [], level: "info", sinks: ["console", "file"]},
						],
					},
					caches: {
						sessions: {module: "@b9g/cache/memory", export: "MemoryCache"},
					},
					directories: {
						uploads: {
							module: "@b9g/filesystem/memory",
							export: "MemoryDirectory",
						},
					},
				}),
			});
			cleanup_paths.push(projectDir);

			const outDir = join(projectDir, "dist");

			const originalCwd = process.cwd();
			process.chdir(projectDir);
			try {
				await buildForProduction({
					entrypoint: join(projectDir, "app.js"),
					outDir,
					verbose: false,
					platform: "node",
				});
			} finally {
				process.chdir(originalCwd);
			}

			// Run the bundle - this is the critical test
			// If any dynamic imports fail to resolve, we'll see errors
			const result = await runBundle(join(outDir, "server"));

			// The key assertion: no module resolution errors at runtime
			expect(result.stderr).not.toContain("Cannot find module");
			expect(result.stderr).not.toContain("Could not resolve");
			expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");

			// Should start up successfully
			expect(result.stdout).toContain("FULL_PROVIDER_TEST_START");
			expect(result.stdout).toContain("FULL_PROVIDER_TEST_READY");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

// ======================
// LOGGING SINKS ARE STATICALLY BUNDLED
// ======================

test(
	"E2E: logging sink factories are statically bundled",
	async () => {
		const cleanup_paths = [];

		try {
			const projectDir = await createTestProject({
				"app.js": `
console.log("SINK_BUNDLE_TEST_START");

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("OK"));
});

console.log("SINK_BUNDLE_TEST_READY");
				`,
				"shovel.json": JSON.stringify({
					port: 3000,
					workers: 1,
					logging: {
						sinks: {
							console: {module: "@logtape/logtape", export: "getConsoleSink"},
							appLog: {
								module: "@logtape/file",
								export: "getFileSink",
								path: "/tmp/test.log",
							},
						},
						loggers: [
							{category: [], level: "debug", sinks: ["console", "appLog"]},
						],
					},
				}),
			});
			cleanup_paths.push(projectDir);

			const outDir = join(projectDir, "dist");

			const originalCwd = process.cwd();
			process.chdir(projectDir);
			try {
				await buildForProduction({
					entrypoint: join(projectDir, "app.js"),
					outDir,
					verbose: false,
					platform: "node",
				});
			} finally {
				process.chdir(originalCwd);
			}

			// Verify sink factories are bundled (not dynamically imported)
			const indexContent = await FS.readFile(
				join(outDir, "server", "index.js"),
				"utf8",
			);

			// These factory functions should be in the bundle
			expect(indexContent).toContain("getConsoleSink");
			expect(indexContent).toContain("getFileSink");

			// Config should have impl references (not dynamic import paths)
			// The pattern "impl:" indicates the implementation was statically imported
			expect(indexContent).toContain("impl:");

			// Run the bundle to verify sinks work
			const result = await runBundle(join(outDir, "server"));
			expect(result.stderr).not.toContain("Cannot find module");
			expect(result.stdout).toContain("SINK_BUNDLE_TEST_START");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

// ======================
// STRICT ISOLATION TEST: No External Modules Available
// ======================

test(
	"E2E: bundle runs in isolation without node_modules",
	async () => {
		const cleanup_paths = [];

		try {
			const projectDir = await createTestProject({
				"app.js": `
console.log("ISOLATION_TEST_START");

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Isolated bundle works!"));
});

console.log("ISOLATION_TEST_READY");
				`,
				"shovel.json": JSON.stringify({
					port: 3000,
					workers: 1,
					logging: {
						sinks: {
							console: {module: "@logtape/logtape", export: "getConsoleSink"},
						},
						loggers: [{category: [], level: "info", sinks: ["console"]}],
					},
					caches: {
						"*": {module: "@b9g/cache/memory", export: "MemoryCache"},
					},
					directories: {
						uploads: {
							module: "@b9g/filesystem/memory",
							export: "MemoryDirectory",
						},
					},
				}),
			});
			cleanup_paths.push(projectDir);

			const outDir = join(projectDir, "dist");

			const originalCwd = process.cwd();
			process.chdir(projectDir);
			try {
				await buildForProduction({
					entrypoint: join(projectDir, "app.js"),
					outDir,
					verbose: false,
					platform: "node",
				});
			} finally {
				process.chdir(originalCwd);
			}

			// CRITICAL: Remove node_modules symlink to test true isolation
			// If any dynamic imports exist that require node_modules, they'll fail
			const nodeModulesLink = join(projectDir, "node_modules");
			await FS.rm(nodeModulesLink, {recursive: true, force: true});

			// Also ensure the server directory has no node_modules
			const serverNodeModules = join(outDir, "server", "node_modules");
			try {
				await FS.rm(serverNodeModules, {recursive: true, force: true});
			} catch (err) {
				logger.debug`Removing server node_modules: ${err}`;
			}

			// Run the bundle in complete isolation
			const result = await runBundle(join(outDir, "server"));

			// If there are any unbundled dynamic imports, we'll see module errors
			expect(result.stderr).not.toContain("Cannot find module");
			expect(result.stderr).not.toContain("Could not resolve");
			expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
			expect(result.stderr).not.toContain("Cannot find package");

			// Should start successfully
			expect(result.stdout).toContain("ISOLATION_TEST_START");
			expect(result.stdout).toContain("ISOLATION_TEST_READY");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

// ======================
// VERIFY NO VARIABLE DYNAMIC IMPORTS IN CRITICAL PATHS
// ======================

test(
	"E2E: config module uses static provider references, not strings",
	async () => {
		const cleanup_paths = [];

		try {
			const projectDir = await createTestProject({
				"app.js": `
console.log("STATIC_REF_TEST");
self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("OK"));
});
				`,
				"shovel.json": JSON.stringify({
					port: 3000,
					workers: 1,
					logging: {
						// Console and file sinks should be statically imported
						sinks: {
							console: {module: "@logtape/logtape", export: "getConsoleSink"},
							file: {
								module: "@logtape/file",
								export: "getFileSink",
								path: "/tmp/test.log",
							},
						},
						loggers: [
							{category: [], level: "info", sinks: ["console", "file"]},
						],
					},
				}),
			});
			cleanup_paths.push(projectDir);

			const outDir = join(projectDir, "dist");

			const originalCwd = process.cwd();
			process.chdir(projectDir);
			try {
				await buildForProduction({
					entrypoint: join(projectDir, "app.js"),
					outDir,
					verbose: false,
					platform: "node",
				});
			} finally {
				process.chdir(originalCwd);
			}

			// Read the worker bundle which contains the config
			const workerContent = await FS.readFile(
				join(outDir, "server", "worker.js"),
				"utf8",
			);

			// The config should have impl: references (statically imported functions)
			// NOT dynamic imports like: await import(providerPath)
			expect(workerContent).toContain("impl:");

			// Sink factories should be bundled inline
			expect(workerContent).toContain("getConsoleSink");
			expect(workerContent).toContain("getFileSink");

			// There should be no dynamic import of sink modules by path string
			// Pattern: import("@logtape/...) with a variable would fail
			expect(workerContent).not.toMatch(/await\s+import\s*\(\s*["']@logtape/);
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

// ======================
// BUILD CONFIG E2E TESTS
// ======================

test(
	"E2E: build config define option injects constants",
	async () => {
		const cleanup_paths = [];

		try {
			const projectDir = await createTestProject({
				"app.js": `
console.log("BUILD_CONFIG_TEST_START");
console.log("VERSION:", __APP_VERSION__);
console.log("BUILD_ENV:", __BUILD_ENV__);

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Version: " + __APP_VERSION__));
});

console.log("BUILD_CONFIG_TEST_READY");
				`,
				"shovel.json": JSON.stringify({
					port: 3000,
					workers: 1,
					build: {
						define: {
							__APP_VERSION__: '"1.2.3"',
							__BUILD_ENV__: '"production"',
						},
					},
				}),
			});
			cleanup_paths.push(projectDir);

			const outDir = join(projectDir, "dist");

			const originalCwd = process.cwd();
			process.chdir(projectDir);
			try {
				// Load config to get build settings
				const config = loadConfig(projectDir);
				await buildForProduction({
					entrypoint: join(projectDir, "app.js"),
					outDir,
					verbose: false,
					platform: "node",
					userBuildConfig: config.build,
				});
			} finally {
				process.chdir(originalCwd);
			}

			// Verify defines are injected in the bundle (worker.js for Node platform)
			const workerContent = await FS.readFile(
				join(outDir, "server", "worker.js"),
				"utf8",
			);

			// The define values should be inlined in the bundle
			expect(workerContent).toContain("1.2.3");
			expect(workerContent).toContain("production");

			// Run the bundle
			const result = await runBundle(join(outDir, "server"));

			// Should print the defined constants
			expect(result.stdout).toContain("BUILD_CONFIG_TEST_START");
			expect(result.stdout).toContain("VERSION:");
			expect(result.stdout).toContain("1.2.3");
			expect(result.stdout).toContain("BUILD_ENV:");
			expect(result.stdout).toContain("production");
			expect(result.stdout).toContain("BUILD_CONFIG_TEST_READY");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

test(
	"E2E: build config minify option minifies output",
	async () => {
		const cleanup_paths = [];

		try {
			const projectDir = await createTestProject({
				"app.js": `
// This is a comment that should be removed when minified
const veryLongVariableNameThatShouldBeShortened = "hello";
const anotherLongVariableName = "world";

function aFunctionWithAVeryLongNameForTesting() {
	return veryLongVariableNameThatShouldBeShortened + " " + anotherLongVariableName;
}

console.log("MINIFY_TEST_MARKER");

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response(aFunctionWithAVeryLongNameForTesting()));
});
				`,
				"shovel.json": JSON.stringify({
					port: 3000,
					workers: 1,
					build: {
						minify: true,
					},
				}),
			});
			cleanup_paths.push(projectDir);

			const outDir = join(projectDir, "dist");

			const originalCwd = process.cwd();
			process.chdir(projectDir);
			try {
				// Load config to get build settings
				const config = loadConfig(projectDir);
				await buildForProduction({
					entrypoint: join(projectDir, "app.js"),
					outDir,
					verbose: false,
					platform: "node",
					userBuildConfig: config.build,
				});
			} finally {
				process.chdir(originalCwd);
			}

			// Verify the worker.js (user code for Node platform) is minified
			const workerContent = await FS.readFile(
				join(outDir, "server", "worker.js"),
				"utf8",
			);

			// Comments should be removed
			expect(
				workerContent.includes("This is a comment that should be removed"),
			).toBe(false);

			// Long variable names should be shortened
			expect(
				workerContent.includes("veryLongVariableNameThatShouldBeShortened"),
			).toBe(false);
			expect(
				workerContent.includes("aFunctionWithAVeryLongNameForTesting"),
			).toBe(false);

			// But the marker string should still be present (strings aren't renamed)
			expect(workerContent).toContain("MINIFY_TEST_MARKER");

			// Run the bundle to verify it still works
			const result = await runBundle(join(outDir, "server"));
			expect(result.stdout).toContain("MINIFY_TEST_MARKER");
			expect(result.stderr).not.toContain("Cannot find module");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

test(
	"E2E: build config sourcemap option generates source maps",
	async () => {
		const cleanup_paths = [];

		try {
			const projectDir = await createTestProject({
				"app.js": `
console.log("SOURCEMAP_TEST");

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("OK"));
});
				`,
				"shovel.json": JSON.stringify({
					port: 3000,
					workers: 1,
					build: {
						sourcemap: "external",
					},
				}),
			});
			cleanup_paths.push(projectDir);

			const outDir = join(projectDir, "dist");

			const originalCwd = process.cwd();
			process.chdir(projectDir);
			try {
				// Load config to get build settings
				const config = loadConfig(projectDir);
				await buildForProduction({
					entrypoint: join(projectDir, "app.js"),
					outDir,
					verbose: false,
					platform: "node",
					userBuildConfig: config.build,
				});
			} finally {
				process.chdir(originalCwd);
			}

			// Verify source maps are generated
			const serverDir = join(outDir, "server");
			const files = await FS.readdir(serverDir);

			// Should have .js.map files
			const mapFiles = files.filter((f) => f.endsWith(".map"));
			expect(mapFiles.length).toBeGreaterThan(0);

			// Verify the map files include our source files (Node platform: index.js + worker.js)
			expect(mapFiles).toContain("index.js.map");
			expect(mapFiles).toContain("worker.js.map");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

test(
	"E2E: build config external option excludes modules from bundle",
	async () => {
		const cleanup_paths = [];

		try {
			const projectDir = await createTestProject({
				"app.js": `
console.log("EXTERNAL_TEST_START");

// This import should be kept as external (not bundled)
// Using a Node builtin that we explicitly mark as external
import {platform} from "node:os";

console.log("Platform:", platform());

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Platform: " + platform()));
});

console.log("EXTERNAL_TEST_READY");
				`,
				"shovel.json": JSON.stringify({
					port: 3000,
					workers: 1,
					build: {
						// Add additional externals beyond the default node:* pattern
						external: ["some-native-module"],
					},
				}),
			});
			cleanup_paths.push(projectDir);

			const outDir = join(projectDir, "dist");

			const originalCwd = process.cwd();
			process.chdir(projectDir);
			try {
				// Load config to get build settings
				const config = loadConfig(projectDir);
				await buildForProduction({
					entrypoint: join(projectDir, "app.js"),
					outDir,
					verbose: false,
					platform: "node",
					userBuildConfig: config.build,
				});
			} finally {
				process.chdir(originalCwd);
			}

			// Verify the worker code has external import (Node platform)
			const workerContent = await FS.readFile(
				join(outDir, "server", "worker.js"),
				"utf8",
			);

			// node:os should be an external import (not bundled)
			expect(workerContent).toContain("node:os");

			// Run the bundle to verify it works
			const result = await runBundle(join(outDir, "server"));
			expect(result.stdout).toContain("EXTERNAL_TEST_START");
			expect(result.stdout).toContain("Platform:");
			expect(result.stdout).toContain("EXTERNAL_TEST_READY");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

test(
	"E2E: build config plugin loads from project node_modules",
	async () => {
		const cleanup_paths = [];

		try {
			// Create a simple esbuild plugin in the project
			const projectDir = await createTestProject({
				"app.js": `
console.log("PLUGIN_TEST_START");
// The plugin should add this marker during build
console.log("PLUGIN_TRANSFORM_MARKER");

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("OK"));
});

console.log("PLUGIN_TEST_READY");
				`,
				// Create a local plugin file (simulating a plugin in node_modules)
				"my-plugin.js": `
// Simple esbuild plugin that adds a banner comment
export default function myPlugin(options = {}) {
	return {
		name: "my-plugin",
		setup(build) {
			build.onEnd(() => {
				console.log("MY_PLUGIN_EXECUTED");
			});
		}
	};
}
				`,
				"shovel.json": JSON.stringify({
					port: 3000,
					workers: 1,
					build: {
						plugins: [
							{
								module: "./my-plugin.js",
							},
						],
					},
				}),
			});
			cleanup_paths.push(projectDir);

			const outDir = join(projectDir, "dist");

			const originalCwd = process.cwd();
			process.chdir(projectDir);
			try {
				// Load config to get build settings
				const config = loadConfig(projectDir);
				await buildForProduction({
					entrypoint: join(projectDir, "app.js"),
					outDir,
					verbose: false,
					platform: "node",
					userBuildConfig: config.build,
				});
			} finally {
				process.chdir(originalCwd);
			}

			// Run the bundle to verify it works
			const result = await runBundle(join(outDir, "server"));
			expect(result.stdout).toContain("PLUGIN_TEST_START");
			expect(result.stdout).toContain("PLUGIN_TEST_READY");
			expect(result.stderr).not.toContain("Cannot find module");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

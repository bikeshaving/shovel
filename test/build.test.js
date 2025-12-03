/* eslint-disable no-restricted-properties -- Tests need process.cwd/env */
import * as FS from "fs/promises";
import {tmpdir} from "os";
import {join} from "path";
import {test, expect} from "bun:test";
import {buildForProduction} from "../src/commands/build.js";

/**
 * Build system tests - comprehensive validation of production builds
 * Tests the refactored build system with error handling and platform support
 */

const TIMEOUT = 5000; // 5 second timeout

// Helper to create temporary test files
async function createTempFile(filename, content) {
	const tempPath = join(tmpdir(), filename);
	await FS.writeFile(tempPath, content, "utf8");
	return tempPath;
}

// Helper to create temporary directory
async function createTempDir(prefix = "shovel-test-") {
	const tempPath = join(tmpdir(), `${prefix}${Date.now()}`);
	await FS.mkdir(tempPath, {recursive: true});
	return tempPath;
}

// Helper to clean up files/directories
async function cleanup(paths) {
	for (const path of paths) {
		try {
			const stat = await FS.stat(path);
			if (stat.isDirectory()) {
				await FS.rm(path, {recursive: true, force: true});
			} else {
				await FS.unlink(path);
			}
		} catch {
			// File/directory already removed
		}
	}
}

// Helper to check if file exists
async function fileExists(path) {
	try {
		await FS.access(path);
		return true;
	} catch {
		return false;
	}
}

// ======================
// BASIC BUILD TESTS
// ======================

test(
	"basic build - valid entry point",
	async () => {
		const cleanup_paths = [];

		try {
			// Create a simple ServiceWorker file
			const entryContent = `
self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Hello from test ServiceWorker!", {
		headers: { "content-type": "text/plain" }
	}));
});
			`;

			const entryPath = await createTempFile("test-entry.js", entryContent);
			const outDir = await createTempDir("build-test-");
			cleanup_paths.push(entryPath, outDir);

			// Build should succeed
			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "node",
			});

			// Check output files exist in new structure
			expect(await fileExists(join(outDir, "server", "index.js"))).toBe(true);
			expect(await fileExists(join(outDir, "server", "package.json"))).toBe(
				true,
			);
			expect(await fileExists(join(outDir, "server", "manifest.json"))).toBe(
				true,
			);
			// Note: static/assets is only created when entry point has asset imports

			// Check index.js exists and contains production server code
			const appContent = await FS.readFile(
				join(outDir, "server", "index.js"),
				"utf8",
			);
			// Should contain platform imports and server setup
			expect(appContent).toContain("platform");
			expect(appContent).toContain("loadServiceWorker");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

test(
	"build with different platforms",
	async () => {
		const cleanup_paths = [];
		const platforms = ["node", "bun", "cloudflare"];

		for (const platform of platforms) {
			try {
				const entryContent = `
self.addEventListener("fetch", (event) => {
	event.respondWith(new Response(\`Platform: ${platform}\`, {
		headers: { "content-type": "text/plain" }
	}));
});
				`;

				const entryPath = await createTempFile(
					`test-${platform}.js`,
					entryContent,
				);
				const outDir = await createTempDir(`build-${platform}-`);
				cleanup_paths.push(entryPath, outDir);

				await buildForProduction({
					entrypoint: entryPath,
					outDir,
					verbose: false,
					platform,
				});

				// Verify platform-specific output
				// All platforms now use server.js for user code (single-file for Cloudflare, user code for Node/Bun)
				const appContent = await FS.readFile(
					join(outDir, "server", "server.js"),
					"utf8",
				);
				expect(appContent).toContain(`Platform: ${platform}`);

				// Cloudflare builds have different structure (browser-based)
				if (platform === "cloudflare") {
					// Cloudflare builds should not have shebang
					expect(appContent.startsWith("#!/usr/bin/env")).toBe(false);
					// Should have Cloudflare-specific wrapper
					expect(appContent).toContain("addEventListener");
				} else {
					// Node/Bun builds: check index.js for platform bootstrap
					const indexContent = await FS.readFile(
						join(outDir, "server", "index.js"),
						"utf8",
					);
					// Should contain bundled platform code
					expect(indexContent).toContain("loadServiceWorker");
					expect(indexContent).toContain("CustomCacheStorage");
				}
			} catch (error) {
				console.error(`Platform ${platform} failed:`, error);
				throw error;
			}
		}

		await cleanup(cleanup_paths);
	},
	TIMEOUT,
);

// ======================
// ERROR HANDLING TESTS
// ======================

test(
	"build error - missing entry point",
	async () => {
		const outDir = await createTempDir("error-test-");

		try {
			await expect(
				buildForProduction({
					entrypoint: "/nonexistent/file.js",
					outDir,
					verbose: false,
					platform: "node",
				}),
			).rejects.toThrow(/Entry point not found/);
		} finally {
			await cleanup([outDir]);
		}
	},
	TIMEOUT,
);

test(
	"build error - invalid platform",
	async () => {
		const cleanup_paths = [];

		try {
			const entryPath = await createTempFile(
				"test-invalid.js",
				"console.log('test');",
			);
			const outDir = await createTempDir("invalid-platform-");
			cleanup_paths.push(entryPath, outDir);

			await expect(
				buildForProduction({
					entrypoint: entryPath,
					outDir,
					verbose: false,
					platform: "invalidplatform",
				}),
			).rejects.toThrow(/Invalid platform/);
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

test(
	"build error - missing required parameters",
	async () => {
		// Test missing entrypoint
		await expect(
			buildForProduction({
				outDir: "/tmp",
				verbose: false,
				platform: "node",
			}),
		).rejects.toThrow(/Entry point is required/);

		// Test missing outDir
		await expect(
			buildForProduction({
				entrypoint: "/tmp/test.js",
				verbose: false,
				platform: "node",
			}),
		).rejects.toThrow(/Output directory is required/);
	},
	TIMEOUT,
);

test(
	"build error - empty entry point file",
	async () => {
		const cleanup_paths = [];

		try {
			const entryPath = await createTempFile("empty.js", "");
			const outDir = await createTempDir("empty-test-");
			cleanup_paths.push(entryPath, outDir);

			// Should build but emit warning about empty file
			// This tests our file validation but allows build to continue
			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: true, // Enable verbose to see warning
				platform: "node",
			});

			// Build should complete but app.js should have bootstrap + empty content
			expect(await fileExists(join(outDir, "server", "index.js"))).toBe(true);
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

// ======================
// OUTPUT VALIDATION TESTS
// ======================

test(
	"build output structure validation",
	async () => {
		const cleanup_paths = [];

		try {
			const entryContent = `
import "./style.css" with { assetBase: "assets" };

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Styled response", {
		headers: { "content-type": "text/html" }
	}));
});
			`;

			const styleContent = `body { color: blue; }`;

			const entryPath = await createTempFile("with-assets.js", entryContent);
			const stylePath = await createTempFile("style.css", styleContent);
			cleanup_paths.push(entryPath, stylePath);

			const outDir = await createTempDir("structure-test-");
			cleanup_paths.push(outDir);

			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "node",
			});

			// Check required output structure
			expect(await fileExists(join(outDir, "server", "index.js"))).toBe(true);
			expect(await fileExists(join(outDir, "server", "package.json"))).toBe(
				true,
			);
			expect(await fileExists(join(outDir, "server", "manifest.json"))).toBe(
				true,
			);
			expect(await fileExists(join(outDir, "static", "assets"))).toBe(true);

			// Validate app.js content
			const appContent = await FS.readFile(
				join(outDir, "server", "index.js"),
				"utf8",
			);
			// Should contain bundled platform code
			expect(appContent).toContain("loadServiceWorker");
			expect(appContent).toContain("CustomCacheStorage");

			// Validate package.json is valid JSON
			const packageContent = await FS.readFile(
				join(outDir, "server", "package.json"),
				"utf8",
			);
			const packageJson = JSON.parse(packageContent);
			expect(typeof packageJson).toBe("object");

			// Validate assets manifest
			const manifestContent = await FS.readFile(
				join(outDir, "server", "manifest.json"),
				"utf8",
			);
			const manifest = JSON.parse(manifestContent);
			expect(typeof manifest).toBe("object");
			expect(manifest).toHaveProperty("generated");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

test(
	"build with verbose output",
	async () => {
		const cleanup_paths = [];

		try {
			const entryPath = await createTempFile(
				"verbose-test.js",
				`
self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Verbose test"));
});
			`,
			);
			const outDir = await createTempDir("verbose-test-");
			cleanup_paths.push(entryPath, outDir);

			// Capture console output during verbose build
			const originalLog = console.info;
			const logs = [];
			console.info = (...args) => logs.push(args.join(" "));

			try {
				await buildForProduction({
					entrypoint: entryPath,
					outDir,
					verbose: true,
					platform: "node",
				});

				// Check that verbose output includes expected information
				const allLogs = logs.join("\n");
				expect(allLogs).toContain("Entry:");
				expect(allLogs).toContain("Output:");
				expect(allLogs).toContain("Target platform:");
				expect(allLogs).toContain("Project root:");
				expect(allLogs).toContain("Bundle analysis:");
				expect(allLogs).toContain("Generated package.json");
				expect(allLogs).toContain("Built app to");
			} finally {
				console.info = originalLog;
			}
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

// ======================
// PLATFORM-SPECIFIC TESTS
// ======================

test(
	"build external dependencies configuration",
	async () => {
		const cleanup_paths = [];

		try {
			// Test that @b9g packages are properly externalized in the generated templates
			// This tests the virtual entry template, not user code imports
			const entryContent = `
self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Simple ServiceWorker"));
});
			`;

			const entryPath = await createTempFile("external-deps.js", entryContent);
			const outDir = await createTempDir("external-test-");
			cleanup_paths.push(entryPath, outDir);

			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "node",
			});

			const appContent = await FS.readFile(
				join(outDir, "server", "index.js"),
				"utf8",
			);

			// All dependencies including @b9g/* packages are bundled for self-contained builds
			// Verify the bundled code contains expected classes
			expect(appContent).toContain("CustomCacheStorage");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

// ======================
// INTEGRATION TESTS
// ======================

test(
	"build with complex ServiceWorker features",
	async () => {
		const cleanup_paths = [];

		try {
			const entryContent = `
// Test various ServiceWorker APIs and features
self.addEventListener("install", (event) => {
});

self.addEventListener("activate", (event) => {
});

self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);
	
	if (url.pathname === "/") {
		event.respondWith(new Response(\`
			<!DOCTYPE html>
			<html>
				<head><title>Test App</title></head>
				<body>
					<h1>Hello from ServiceWorker!</h1>
					<p>URL: \${url.href}</p>
				</body>
			</html>
		\`, {
			headers: { "content-type": "text/html; charset=utf-8" }
		}));
	} else if (url.pathname === "/api/test") {
		event.respondWith(Response.json({
			message: "API endpoint",
			timestamp: Date.now()
		}));
	} else {
		event.respondWith(new Response("Not found", { status: 404 }));
	}
});

// Test skipWaiting
self.skipWaiting();
			`;

			const entryPath = await createTempFile("complex-sw.js", entryContent);
			const outDir = await createTempDir("complex-test-");
			cleanup_paths.push(entryPath, outDir);

			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "node",
			});

			// Check user code in server.js
			const serverContent = await FS.readFile(
				join(outDir, "server", "server.js"),
				"utf8",
			);

			// Check that all ServiceWorker features are preserved
			expect(serverContent).toContain('addEventListener("install"');
			expect(serverContent).toContain('addEventListener("activate"');
			expect(serverContent).toContain('addEventListener("fetch"');
			expect(serverContent).toContain("skipWaiting()");
			expect(serverContent).toContain("Response.json");

			// Check bootstrap code in index.js sets up globals using ServiceWorkerGlobals
			const indexContent = await FS.readFile(
				join(outDir, "server", "index.js"),
				"utf8",
			);
			expect(indexContent).toContain("scope.install()");
			expect(indexContent).toContain("registration.install()");
			expect(indexContent).toContain("registration.activate()");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

test(
	"build performance with large file",
	async () => {
		const cleanup_paths = [];

		try {
			// Generate a large ServiceWorker file
			const routes = Array.from(
				{length: 100},
				(_, i) => `
	if (url.pathname === "/route${i}") {
		event.respondWith(new Response("Route ${i} response"));
		return;
	}
			`,
			).join("");

			const entryContent = `
self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);
	${routes}
	
	event.respondWith(new Response("Default response"));
});
			`;

			const entryPath = await createTempFile("large-sw.js", entryContent);
			const outDir = await createTempDir("large-test-");
			cleanup_paths.push(entryPath, outDir);

			const startTime = Date.now();

			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "node",
			});

			const buildTime = Date.now() - startTime;

			// Build should complete within reasonable time (less than 10 seconds)
			expect(buildTime).toBeLessThan(10000);

			// Output should exist and be reasonable size
			const serverContent = await FS.readFile(
				join(outDir, "server", "server.js"),
				"utf8",
			);
			expect(serverContent.length).toBeGreaterThan(1000);
			expect(serverContent).toContain("Route 50 response"); // Spot check
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

// ======================
// WORKSPACE RESOLUTION TESTS
// ======================

test(
	"workspace root detection",
	async () => {
		const cleanup_paths = [];

		try {
			// Create a temporary workspace structure
			const workspaceRoot = await createTempDir("workspace-");
			const packageJsonPath = join(workspaceRoot, "package.json");

			// Create workspace package.json with @b9g dependencies
			const packageJson = {
				name: "test-workspace",
				workspaces: ["packages/*"],
				private: true,
				dependencies: {
					"@b9g/platform": "*",
					"@b9g/platform-node": "*",
					"@b9g/cache": "*",
					"@b9g/filesystem": "*",
				},
			};
			await FS.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

			const packagesDir = join(workspaceRoot, "packages", "test-app");
			await FS.mkdir(packagesDir, {recursive: true});

			const entryPath = join(packagesDir, "app.js");
			await FS.writeFile(
				entryPath,
				`
self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Workspace test"));
});
			`,
			);

			const outDir = join(workspaceRoot, "dist");
			cleanup_paths.push(workspaceRoot);

			// Symlink node_modules from workspace root for all dependencies
			const nodeModulesSource = join(process.cwd(), "node_modules");
			const nodeModulesLink = join(workspaceRoot, "node_modules");
			await FS.symlink(nodeModulesSource, nodeModulesLink, "dir");

			const originalCwd = process.cwd();
			process.chdir(packagesDir);

			try {
				await buildForProduction({
					entrypoint: entryPath,
					outDir,
					verbose: false,
					platform: "node",
				});

				// Should have found the workspace root and built successfully
				expect(await fileExists(join(outDir, "server", "index.js"))).toBe(true);

				// Verify the build is self-contained
				// User code is in server.js
				const serverContent = await FS.readFile(
					join(outDir, "server", "server.js"),
					"utf8",
				);
				expect(serverContent).toContain("Workspace test");

				// Platform code should not contain userEntryPath
				const indexContent = await FS.readFile(
					join(outDir, "server", "index.js"),
					"utf8",
				);
				expect(indexContent).not.toContain("userEntryPath");
			} finally {
				process.chdir(originalCwd);
			}
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT * 2, // Longer timeout for symlink setup
);

// ======================
// USER CODE BUNDLING TESTS
// ======================

test(
	"user code is bundled (not dynamically imported)",
	async () => {
		const cleanup_paths = [];

		try {
			const entryContent = `
// Unique marker that should be in bundled output
const UNIQUE_MARKER = "BUNDLED_USER_CODE_12345";

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response(UNIQUE_MARKER));
});
			`;

			const entryPath = await createTempFile("bundled-test.js", entryContent);
			const outDir = await createTempDir("bundled-test-");
			cleanup_paths.push(entryPath, outDir);

			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "node",
			});

			// User code should be bundled into server.js
			const serverContent = await FS.readFile(
				join(outDir, "server", "server.js"),
				"utf8",
			);
			expect(serverContent).toContain("BUNDLED_USER_CODE_12345");

			// Should NOT contain absolute paths to source files in user code
			expect(serverContent).not.toMatch(/\/Users\/.*\/bundled-test\.js/);
			expect(serverContent).not.toMatch(/\/tmp\/.*\/bundled-test\.js/);

			// Platform code (index.js) should NOT contain dynamic import of user entry path
			const indexContent = await FS.readFile(
				join(outDir, "server", "index.js"),
				"utf8",
			);
			expect(indexContent).not.toContain("userEntryPath");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

test(
	"build does not use dynamic import with userEntryPath",
	async () => {
		const cleanup_paths = [];

		try {
			const entryContent = `
self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);
	if (url.pathname === "/test") {
		event.respondWith(new Response("Test response"));
	}
});
			`;

			const entryPath = await createTempFile(
				"no-dynamic-import.js",
				entryContent,
			);
			const outDir = await createTempDir("no-dynamic-import-");
			cleanup_paths.push(entryPath, outDir);

			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "node",
			});

			const appContent = await FS.readFile(
				join(outDir, "server", "index.js"),
				"utf8",
			);

			// Should not contain workerData.userEntryPath pattern (the bug we fixed)
			expect(appContent).not.toMatch(/workerData\.userEntryPath/);
			expect(appContent).not.toMatch(/await import\(workerData/);

			// Should not have userEntryPath in workerData
			expect(appContent).not.toMatch(/userEntryPath:\s*["']/);
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

test(
	"multiple platforms bundle user code consistently",
	async () => {
		const cleanup_paths = [];

		try {
			const entryContent = `
const PLATFORM_TEST_MARKER = "MULTI_PLATFORM_TEST";

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response(PLATFORM_TEST_MARKER));
});
			`;

			const entryPath = await createTempFile("multi-platform.js", entryContent);
			cleanup_paths.push(entryPath);

			// Test Node platform
			const nodeOutDir = await createTempDir("node-platform-");
			cleanup_paths.push(nodeOutDir);

			await buildForProduction({
				entrypoint: entryPath,
				outDir: nodeOutDir,
				verbose: false,
				platform: "node",
			});

			// User code is in server.js for Node/Bun
			const nodeServerContent = await FS.readFile(
				join(nodeOutDir, "server", "server.js"),
				"utf8",
			);

			// Test Bun platform
			const bunOutDir = await createTempDir("bun-platform-");
			cleanup_paths.push(bunOutDir);

			await buildForProduction({
				entrypoint: entryPath,
				outDir: bunOutDir,
				verbose: false,
				platform: "bun",
			});

			const bunServerContent = await FS.readFile(
				join(bunOutDir, "server", "server.js"),
				"utf8",
			);

			// Both should bundle user code
			expect(nodeServerContent).toContain("MULTI_PLATFORM_TEST");
			expect(bunServerContent).toContain("MULTI_PLATFORM_TEST");

			// Platform code (index.js) should not have hardcoded paths
			const nodeIndexContent = await FS.readFile(
				join(nodeOutDir, "server", "index.js"),
				"utf8",
			);
			const bunIndexContent = await FS.readFile(
				join(bunOutDir, "server", "index.js"),
				"utf8",
			);
			expect(nodeIndexContent).not.toContain("userEntryPath");
			expect(bunIndexContent).not.toContain("userEntryPath");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

test(
	"user code with imports is fully bundled",
	async () => {
		const cleanup_paths = [];

		try {
			// Create a module that the entry imports
			const helperContent = `
export function getResponse() {
	return "HELPER_MODULE_RESPONSE";
}
			`;

			const helperPath = await createTempFile("helper.js", helperContent);
			cleanup_paths.push(helperPath);

			const entryContent = `
import { getResponse } from "${helperPath}";

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response(getResponse()));
});
			`;

			const entryPath = await createTempFile("with-imports.js", entryContent);
			const outDir = await createTempDir("imports-test-");
			cleanup_paths.push(entryPath, outDir);

			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "node",
			});

			// User code should be bundled into server.js
			const serverContent = await FS.readFile(
				join(outDir, "server", "server.js"),
				"utf8",
			);

			// Both entry and imported module should be bundled
			expect(serverContent).toContain("HELPER_MODULE_RESPONSE");
			expect(serverContent).toContain("getResponse");

			// Platform code should not have dynamic imports via workerData.userEntryPath
			const indexContent = await FS.readFile(
				join(outDir, "server", "index.js"),
				"utf8",
			);
			expect(indexContent).not.toContain("userEntryPath");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

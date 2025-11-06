import * as FS from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { test, expect } from "bun:test";
import { buildForProduction } from "../src/_build.js";

/**
 * Build system tests - comprehensive validation of production builds
 * Tests the refactored build system with error handling and platform support
 */

const TIMEOUT = 30000; // 30 second timeout

// Helper to create temporary test files
async function createTempFile(filename, content) {
	const tempPath = join(tmpdir(), filename);
	await FS.writeFile(tempPath, content, "utf8");
	return tempPath;
}

// Helper to create temporary directory
async function createTempDir(prefix = "shovel-test-") {
	const tempPath = join(tmpdir(), `${prefix}${Date.now()}`);
	await FS.mkdir(tempPath, { recursive: true });
	return tempPath;
}

// Helper to clean up files/directories
async function cleanup(paths) {
	for (const path of paths) {
		try {
			const stat = await FS.stat(path);
			if (stat.isDirectory()) {
				await FS.rm(path, { recursive: true, force: true });
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
				platform: "node"
			});

			// Check output files exist
			expect(await fileExists(join(outDir, "app.js"))).toBe(true);
			expect(await fileExists(join(outDir, "package.json"))).toBe(true);
			expect(await fileExists(join(outDir, "assets", "manifest.json"))).toBe(true);

			// Check app.js has shebang and bootstrap
			const appContent = await FS.readFile(join(outDir, "app.js"), "utf8");
			expect(appContent.startsWith("#!/usr/bin/env node")).toBe(true);
			expect(appContent).toContain("ServiceWorkerRuntime");
			expect(appContent).toContain("Hello from test ServiceWorker!");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT
);

test(
	"build with different platforms",
	async () => {
		const cleanup_paths = [];
		const platforms = ["node", "bun"];

		for (const platform of platforms) {
			try {
				const entryContent = `
self.addEventListener("fetch", (event) => {
	event.respondWith(new Response(\`Platform: ${platform}\`, {
		headers: { "content-type": "text/plain" }
	}));
});
				`;

				const entryPath = await createTempFile(`test-${platform}.js`, entryContent);
				const outDir = await createTempDir(`build-${platform}-`);
				cleanup_paths.push(entryPath, outDir);

				await buildForProduction({
					entrypoint: entryPath,
					outDir,
					verbose: false,
					platform
				});

				// Verify platform-specific output
				const appContent = await FS.readFile(join(outDir, "app.js"), "utf8");
				expect(appContent).toContain("ServiceWorkerRuntime");
				expect(appContent).toContain(`Platform: ${platform}`);

				// Node and Bun should have external dependencies
				if (platform === "node" || platform === "bun") {
					expect(appContent).toContain("@b9g/platform");
				}
			} catch (error) {
				console.error(`Platform ${platform} failed:`, error);
				throw error;
			}
		}

		await cleanup(cleanup_paths);
	},
	TIMEOUT
);

// ======================
// ERROR HANDLING TESTS
// ======================

test(
	"build error - missing entry point",
	async () => {
		const outDir = await createTempDir("error-test-");

		try {
			await expect(buildForProduction({
				entrypoint: "/nonexistent/file.js",
				outDir,
				verbose: false,
				platform: "node"
			})).rejects.toThrow(/Entry point not found/);
		} finally {
			await cleanup([outDir]);
		}
	},
	TIMEOUT
);

test(
	"build error - invalid platform",
	async () => {
		const cleanup_paths = [];

		try {
			const entryPath = await createTempFile("test-invalid.js", "console.log('test');");
			const outDir = await createTempDir("invalid-platform-");
			cleanup_paths.push(entryPath, outDir);

			await expect(buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "invalidplatform"
			})).rejects.toThrow(/Invalid platform/);
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT
);

test(
	"build error - missing required parameters",
	async () => {
		// Test missing entrypoint
		await expect(buildForProduction({
			outDir: "/tmp",
			verbose: false,
			platform: "node"
		})).rejects.toThrow(/Entry point is required/);

		// Test missing outDir
		await expect(buildForProduction({
			entrypoint: "/tmp/test.js",
			verbose: false,
			platform: "node"
		})).rejects.toThrow(/Output directory is required/);
	},
	TIMEOUT
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
				platform: "node"
			});

			// Build should complete but app.js should have bootstrap + empty content
			expect(await fileExists(join(outDir, "app.js"))).toBe(true);
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT
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
import "./style.css" with { assetBase: "/assets/" };

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
				platform: "node"
			});

			// Check required output structure
			expect(await fileExists(join(outDir, "app.js"))).toBe(true);
			expect(await fileExists(join(outDir, "package.json"))).toBe(true);
			expect(await fileExists(join(outDir, "assets", "manifest.json"))).toBe(true);

			// Validate app.js content
			const appContent = await FS.readFile(join(outDir, "app.js"), "utf8");
			expect(appContent.startsWith("#!/usr/bin/env node")).toBe(true);
			expect(appContent).toContain("Shovel Production Server");
			expect(appContent).toContain("ServiceWorkerRuntime");
			expect(appContent).toContain("createServiceWorkerGlobals");
			expect(appContent).toContain("createBucketStorage");

			// Validate package.json is valid JSON
			const packageContent = await FS.readFile(join(outDir, "package.json"), "utf8");
			const packageJson = JSON.parse(packageContent);
			expect(typeof packageJson).toBe("object");

			// Validate assets manifest
			const manifestContent = await FS.readFile(join(outDir, "assets", "manifest.json"), "utf8");
			const manifest = JSON.parse(manifestContent);
			expect(typeof manifest).toBe("object");
			expect(manifest).toHaveProperty("generated");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT
);

test(
	"build with verbose output",
	async () => {
		const cleanup_paths = [];

		try {
			const entryPath = await createTempFile("verbose-test.js", `
self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Verbose test"));
});
			`);
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
					platform: "node"
				});

				// Check that verbose output includes expected information
				const allLogs = logs.join("\n");
				expect(allLogs).toContain("Entry:");
				expect(allLogs).toContain("Output:");
				expect(allLogs).toContain("Target platform:");
				expect(allLogs).toContain("Workspace root:");
				expect(allLogs).toContain("Bundle analysis:");
				expect(allLogs).toContain("Copied package.json");
				expect(allLogs).toContain("Built app to");
			} finally {
				console.info = originalLog;
			}
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT
);

// ======================
// PLATFORM-SPECIFIC TESTS
// ======================

test(
	"build external dependencies configuration",
	async () => {
		const cleanup_paths = [];

		try {
			const entryContent = `
import { ServiceWorkerRuntime } from "@b9g/platform";

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Using platform import"));
});
			`;

			const entryPath = await createTempFile("external-deps.js", entryContent);
			const outDir = await createTempDir("external-test-");
			cleanup_paths.push(entryPath, outDir);

			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "node"
			});

			const appContent = await FS.readFile(join(outDir, "app.js"), "utf8");

			// For Node/Bun builds, @b9g/* should be external (not bundled)
			// Check that the import is preserved in the banner
			expect(appContent).toContain("from '@b9g/platform'");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT
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
	console.log("ServiceWorker installed");
});

self.addEventListener("activate", (event) => {
	console.log("ServiceWorker activated");
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
				platform: "node"
			});

			const appContent = await FS.readFile(join(outDir, "app.js"), "utf8");

			// Check that all ServiceWorker features are preserved
			expect(appContent).toContain("addEventListener(\"install\"");
			expect(appContent).toContain("addEventListener(\"activate\"");
			expect(appContent).toContain("addEventListener(\"fetch\"");
			expect(appContent).toContain("skipWaiting()");
			expect(appContent).toContain("Response.json");

			// Check bootstrap sets up globals
			expect(appContent).toContain("globalThis.self = runtime");
			expect(appContent).toContain("globalThis.addEventListener");
			expect(appContent).toContain("runtime.install()");
			expect(appContent).toContain("runtime.activate()");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT
);

test(
	"build performance with large file",
	async () => {
		const cleanup_paths = [];

		try {
			// Generate a large ServiceWorker file
			const routes = Array.from({ length: 100 }, (_, i) => `
	if (url.pathname === "/route${i}") {
		event.respondWith(new Response("Route ${i} response"));
		return;
	}
			`).join("");

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
				platform: "node"
			});

			const buildTime = Date.now() - startTime;

			// Build should complete within reasonable time (less than 10 seconds)
			expect(buildTime).toBeLessThan(10000);

			// Output should exist and be reasonable size
			const appContent = await FS.readFile(join(outDir, "app.js"), "utf8");
			expect(appContent.length).toBeGreaterThan(1000);
			expect(appContent).toContain("Route 50 response"); // Spot check
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT
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
			const packageJson = {
				name: "test-workspace",
				workspaces: ["packages/*"]
			};
			await FS.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));

			const packagesDir = join(workspaceRoot, "packages", "test-app");
			await FS.mkdir(packagesDir, { recursive: true });

			const entryPath = join(packagesDir, "app.js");
			await FS.writeFile(entryPath, `
self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Workspace test"));
});
			`);

			const outDir = join(workspaceRoot, "dist");
			cleanup_paths.push(workspaceRoot);

			// Change working directory to the package directory
			const originalCwd = process.cwd();
			process.chdir(packagesDir);

			try {
				await buildForProduction({
					entrypoint: entryPath,
					outDir,
					verbose: true,
					platform: "node"
				});

				// Should have found the workspace root and built successfully
				expect(await fileExists(join(outDir, "app.js"))).toBe(true);
			} finally {
				process.chdir(originalCwd);
			}
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT
);
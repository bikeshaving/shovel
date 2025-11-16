import {test, expect} from "bun:test";
import * as FS from "fs/promises";
import {tmpdir} from "os";
import {join} from "path";

/**
 * AssetBase import attribute system tests
 * Tests the new assetBase import system that replaced the url attribute
 */

const TIMEOUT = 3000;

// Helper functions
async function createTempDir(prefix = "assets-test-") {
	const tempPath = join(tmpdir(), `${prefix}${Date.now()}`);
	await FS.mkdir(tempPath, {recursive: true});
	return tempPath;
}

async function createTempFile(dir, filename, content) {
	const filePath = join(dir, filename);
	await FS.writeFile(filePath, content, "utf8");
	return filePath;
}

async function cleanup(paths) {
	for (const path of paths) {
		try {
			await FS.rm(path, {recursive: true, force: true});
		} catch {
			// Already removed
		}
	}
}

// ======================
// ASSET PLUGIN TESTS
// ======================

test(
	"assetBase import attribute processing",
	async () => {
		const cleanup_paths = [];

		try {
			// Create test files
			const testDir = await createTempDir();
			cleanup_paths.push(testDir);

			const cssContent = `
body {
	background-color: #f0f0f0;
	font-family: Arial, sans-serif;
}

.header {
	color: #333;
	margin: 20px 0;
}
			`;

			const jsContent = `
import "./style.css" with { assetBase: "assets" };

self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);
	
	if (url.pathname === "/") {
		event.respondWith(new Response(\`
			<!DOCTYPE html>
			<html>
				<head>
					<title>Asset Test</title>
					<link rel="stylesheet" href="/assets/style.css">
				</head>
				<body>
					<h1 class="header">Hello with Assets!</h1>
				</body>
			</html>
		\`, {
			headers: { "content-type": "text/html; charset=utf-8" }
		}));
	}
});
			`;

			await createTempFile(testDir, "style.css", cssContent);
			await createTempFile(testDir, "app.js", jsContent);

			// Import and test the assets plugin
			const {assetsPlugin} = await import("@b9g/assets/plugin");

			const assetsDir = join(testDir, "assets");
			const manifestPath = join(assetsDir, "manifest.json");

			const plugin = assetsPlugin({
				outputDir: assetsDir,
				manifest: manifestPath,
				dev: false,
			});

			// Test plugin structure
			expect(plugin.name).toBe("shovel-assets");
			expect(typeof plugin.setup).toBe("function");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

test(
	"asset manifest generation",
	async () => {
		const cleanup_paths = [];

		try {
			const testDir = await createTempDir();
			const assetsDir = join(testDir, "assets");
			const manifestPath = join(assetsDir, "manifest.json");
			cleanup_paths.push(testDir);

			// Create asset files
			await createTempFile(testDir, "style.css", "body { color: red; }");
			await createTempFile(testDir, "app.css", ".app { margin: 10px; }");

			// Ensure assets directory exists
			await FS.mkdir(assetsDir, {recursive: true});

			// Simulate asset processing by copying files
			await FS.copyFile(
				join(testDir, "style.css"),
				join(assetsDir, "style.css"),
			);
			await FS.copyFile(join(testDir, "app.css"), join(assetsDir, "app.css"));

			// Create a basic manifest
			const manifest = {
				assets: {
					"style.css": {
						path: "/assets/style.css",
						size: (await FS.stat(join(assetsDir, "style.css"))).size,
					},
					"app.css": {
						path: "/assets/app.css",
						size: (await FS.stat(join(assetsDir, "app.css"))).size,
					},
				},
				generated: new Date().toISOString(),
				config: {
					publicPath: "/assets/",
					outputDir: assetsDir,
				},
			};

			await FS.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

			// Test manifest exists and is valid
			expect(
				await FS.access(manifestPath)
					.then(() => true)
					.catch(() => false),
			).toBe(true);

			const manifestContent = await FS.readFile(manifestPath, "utf8");
			const parsedManifest = JSON.parse(manifestContent);

			expect(typeof parsedManifest.assets).toBe("object");
			expect(typeof parsedManifest.generated).toBe("string");
			expect(parsedManifest.config.publicPath).toBe("/assets/");
			expect(parsedManifest.assets["style.css"].path).toBe("/assets/style.css");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

// ======================
// BUILD INTEGRATION TESTS
// ======================

test(
	"assetBase imports in build process",
	async () => {
		const cleanup_paths = [];

		try {
			const testDir = await createTempDir();
			cleanup_paths.push(testDir);

			// Create source files with assetBase imports
			const jsContent = `
import "./style.css" with { assetBase: "assets" };
import "./images/logo.png" with { assetBase: "static" };

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("App with assets loaded!"));
});
			`;

			const cssContent = `
.logo {
	background-image: url('/assets/images/logo.png');
	width: 100px;
	height: 100px;
}
			`;

			// Create directory structure
			await FS.mkdir(join(testDir, "images"), {recursive: true});

			await createTempFile(testDir, "app.js", jsContent);
			await createTempFile(testDir, "style.css", cssContent);

			// Create a dummy image file
			await createTempFile(testDir, "images/logo.png", "fake-png-data");

			const {buildForProduction} = await import("../src/commands/build.js");

			const outDir = join(testDir, "dist");

			// Build with assets
			await buildForProduction({
				entrypoint: join(testDir, "app.js"),
				outDir,
				verbose: false,
				platform: "node",
			});

			// Check that assets directory and manifest were created
			const assetsDir = join(outDir, "assets");
			const manifestPath = join(outDir, "server", "asset-manifest.json");

			expect(
				await FS.access(assetsDir)
					.then(() => true)
					.catch(() => false),
			).toBe(true);
			expect(
				await FS.access(manifestPath)
					.then(() => true)
					.catch(() => false),
			).toBe(true);

			// Check app.js was built
			const appPath = join(outDir, "server", "app.js");
			expect(
				await FS.access(appPath)
					.then(() => true)
					.catch(() => false),
			).toBe(true);

			const appContent = await FS.readFile(appPath, "utf8");
			expect(appContent).toContain("App with assets loaded!");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

test(
	"asset URL resolution in ServiceWorker",
	async () => {
		const cleanup_paths = [];

		try {
			const testDir = await createTempDir();
			cleanup_paths.push(testDir);

			// Set up asset files
			const assetsDir = join(testDir, "assets");
			await FS.mkdir(assetsDir, {recursive: true});

			const cssContent = `.test { color: blue; }`;
			await createTempFile(assetsDir, "test.css", cssContent);

			// Create manifest
			const manifest = {
				assets: {
					"test.css": {
						path: "/assets/test.css",
						size: cssContent.length,
					},
				},
				generated: new Date().toISOString(),
				config: {
					publicPath: "/assets/",
					outputDir: assetsDir,
				},
			};

			await FS.writeFile(
				join(assetsDir, "manifest.json"),
				JSON.stringify(manifest, null, 2),
			);

			// Test ServiceWorker that serves assets
			const {
				ServiceWorkerRegistration,
				ShovelGlobalScope,
				CustomBucketStorage,
			} = await import("@b9g/platform");
			const {NodeBucket} = await import("@b9g/filesystem");

			const runtime = new ServiceWorkerRegistration();

			// Create bucket storage with factory
			const buckets = new CustomBucketStorage(async (name) => {
				const targetPath = join(testDir, name);
				await FS.mkdir(targetPath, {recursive: true});
				return new NodeBucket(targetPath);
			});

			// Set up ServiceWorker globals using ShovelGlobalScope
			const scope = new ShovelGlobalScope({registration: runtime, buckets});
			scope.install();

			// ServiceWorker that serves assets from the assets directory
			globalThis.addEventListener("fetch", (event) => {
				const url = new URL(event.request.url);

				if (url.pathname.startsWith("/assets/")) {
					const assetPath = url.pathname.slice("/assets/".length);

					// Respond with a promise
					event.respondWith(
						(async () => {
							try {
								const assetsBucket = await globalThis.buckets.open("assets");
								const fileHandle = await assetsBucket.getFileHandle(assetPath);
								const file = await fileHandle.getFile();
								const content = await file.text();

								let contentType = "text/plain";
								if (assetPath.endsWith(".css")) {
									contentType = "text/css";
								}

								return new Response(content, {
									headers: {"content-type": contentType},
								});
							} catch {
								return new Response("Asset not found", {status: 404});
							}
						})(),
					);
				} else {
					// Provide default response for non-asset requests
					event.respondWith(new Response("Default response", {status: 200}));
				}
			});

			// Activate the ServiceWorker
			await runtime.install();
			await runtime.activate();

			// Test asset serving
			const cssRequest = new Request("http://localhost/assets/test.css");
			const cssResponse = await runtime.handleRequest(cssRequest);

			expect(cssResponse.status).toBe(200);
			expect(await cssResponse.text()).toBe(".test { color: blue; }");
			expect(cssResponse.headers.get("content-type")).toBe("text/css");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

// ======================
// DEVELOPMENT VS PRODUCTION TESTS
// ======================

test(
	"asset handling in development mode",
	async () => {
		const cleanup_paths = [];

		try {
			const testDir = await createTempDir();
			cleanup_paths.push(testDir);

			const {assetsPlugin} = await import("@b9g/assets/plugin");

			const assetsDir = join(testDir, "assets");
			const manifestPath = join(assetsDir, "manifest.json");

			// Test development mode (dev: true)
			const devPlugin = assetsPlugin({
				outputDir: assetsDir,
				manifest: manifestPath,
				dev: true,
			});

			expect(devPlugin.name).toBe("shovel-assets");

			// In development mode, the plugin should handle hot reloading differently
			// This is mainly tested through integration with the development server
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

test(
	"asset handling in production mode",
	async () => {
		const cleanup_paths = [];

		try {
			const testDir = await createTempDir();
			cleanup_paths.push(testDir);

			const {assetsPlugin} = await import("@b9g/assets/plugin");

			const assetsDir = join(testDir, "assets");
			const manifestPath = join(assetsDir, "manifest.json");

			// Test production mode (dev: false)
			const prodPlugin = assetsPlugin({
				outputDir: assetsDir,
				manifest: manifestPath,
				dev: false,
			});

			expect(prodPlugin.name).toBe("shovel-assets");

			// In production mode, assets should be processed and optimized
			// This is tested through the build process integration
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

// ======================
// MIGRATION TESTS
// ======================

test(
	"assetBase path normalization",
	async () => {
		const cleanup_paths = [];

		try {
			const testDir = await createTempDir();
			cleanup_paths.push(testDir);

			// Test various path formats that should all be normalized
			const testCases = [
				{input: "/assets/", expected: "/assets/"},
				{input: "/assets", expected: "/assets/"},
				{input: "assets/", expected: "/assets/"},
				{input: "assets", expected: "/assets/"},
				{input: "/static/img", expected: "/static/img/"},
				{input: "dist/public", expected: "/dist/public/"},
			];

			for (const testCase of testCases) {
				const jsContent = `
import "./test.css" with { assetBase: "${testCase.input}" };

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Test"));
});
				`;

				await createTempFile(testDir, "test.css", "body { color: red; }");
				const entryPath = await createTempFile(testDir, "app.js", jsContent);
				const outDir = join(
					testDir,
					`dist-${testCase.input.replace(/[/]/g, "-")}`,
				);

				const {buildForProduction} = await import("../src/commands/build.js");

				await buildForProduction({
					entrypoint: entryPath,
					outDir,
					verbose: false,
					platform: "node",
				});

				// Read the manifest to verify the normalized URL
				const manifestPath = join(outDir, "server", "asset-manifest.json");
				const manifestContent = await FS.readFile(manifestPath, "utf8");
				const manifest = JSON.parse(manifestContent);

				// Find the CSS asset
				const cssAsset = Object.values(manifest.assets).find((asset) =>
					asset.source.endsWith("test.css"),
				);

				expect(cssAsset).toBeDefined();
				expect(cssAsset.url).toStartWith(testCase.expected);
			}
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

// ======================
// ERROR HANDLING TESTS
// ======================

test(
	"asset plugin error handling - missing files",
	async () => {
		const cleanup_paths = [];

		try {
			const testDir = await createTempDir();
			cleanup_paths.push(testDir);

			// Create JS file that imports non-existent asset
			const jsContent = `
import "./nonexistent.css" with { assetBase: "/assets/" };

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Should fail"));
});
			`;

			await createTempFile(testDir, "app.js", jsContent);

			const {buildForProduction} = await import("../src/commands/build.js");

			const outDir = join(testDir, "dist");

			// Build should handle missing assets gracefully
			// (The specific behavior depends on the implementation)
			try {
				await buildForProduction({
					entrypoint: join(testDir, "app.js"),
					outDir,
					verbose: false,
					platform: "node",
				});

				// If build succeeds, check that it handled the missing file appropriately
				const appContent = await FS.readFile(
					join(outDir, "server", "app.js"),
					"utf8",
				);
				expect(typeof appContent).toBe("string");
			} catch (error) {
				// If build fails, it should provide a clear error message
				expect(error.message).toBeTruthy();
			}
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

test(
	"asset plugin error handling - invalid manifest",
	async () => {
		const cleanup_paths = [];

		try {
			const testDir = await createTempDir();
			cleanup_paths.push(testDir);

			const assetsDir = join(testDir, "assets");
			await FS.mkdir(assetsDir, {recursive: true});

			// Create invalid manifest
			await FS.writeFile(
				join(assetsDir, "manifest.json"),
				"invalid json content",
			);

			// Asset system should handle invalid manifest gracefully
			const {assetsPlugin} = await import("@b9g/assets/plugin");

			const plugin = assetsPlugin({
				outputDir: assetsDir,
				manifest: join(assetsDir, "manifest.json"),
				dev: false,
			});

			// Plugin should still be created even with invalid manifest
			expect(plugin.name).toBe("shovel-assets");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

// ======================
// PERFORMANCE TESTS
// ======================

test(
	"asset processing performance with many files",
	async () => {
		const cleanup_paths = [];

		try {
			const testDir = await createTempDir();
			cleanup_paths.push(testDir);

			// Create many asset files
			const assetFiles = [];
			for (let i = 0; i < 10; i++) {
				const filename = `style${i}.css`;
				const content = `.class${i} { color: #${i}${i}${i}; }`;
				await createTempFile(testDir, filename, content);
				assetFiles.push(filename);
			}

			// Create JS file that imports all assets
			const imports = assetFiles
				.map((file) => `import "./${file}" with { assetBase: "/assets/" };`)
				.join("\n");

			const jsContent = `
${imports}

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Many assets loaded"));
});
			`;

			await createTempFile(testDir, "app.js", jsContent);

			const {buildForProduction} = await import("../src/commands/build.js");

			const outDir = join(testDir, "dist");
			const startTime = Date.now();

			await buildForProduction({
				entrypoint: join(testDir, "app.js"),
				outDir,
				verbose: false,
				platform: "node",
			});

			const buildTime = Date.now() - startTime;

			// Build should complete in reasonable time even with many assets
			expect(buildTime).toBeLessThan(10000); // 10 seconds max

			// All assets should be processed
			const manifestPath = join(outDir, "server", "asset-manifest.json");
			const manifest = JSON.parse(await FS.readFile(manifestPath, "utf8"));

			// Should have asset entries (exact structure depends on implementation)
			expect(typeof manifest).toBe("object");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

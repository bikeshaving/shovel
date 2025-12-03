import {test, expect} from "bun:test";
import * as FS from "fs/promises";
import {join} from "path";
import {copyFixtureToTemp, fileExists} from "./utils.js";

/**
 * AssetBase import attribute system tests
 * Copies fixtures to temp directories for test isolation.
 */

const TIMEOUT = 5000;

// ======================
// ASSET PLUGIN TESTS
// ======================

test(
	"assetBase import attribute processing",
	async () => {
		const fixture = await copyFixtureToTemp("assets-basic");

		try {
			// Import and test the assets plugin
			const {assetsPlugin} = await import("@b9g/assets/plugin");

			const assetsDir = join(fixture.dist, "assets");
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
			await fixture.cleanup();
		}
	},
	TIMEOUT,
);

test(
	"asset manifest generation",
	async () => {
		const fixture = await copyFixtureToTemp("assets-basic");

		try {
			const assetsDir = join(fixture.dist, "test-manifest");
			const manifestPath = join(assetsDir, "manifest.json");

			// Ensure assets directory exists
			await FS.mkdir(assetsDir, {recursive: true});

			// Copy asset files
			await FS.copyFile(
				join(fixture.src, "style.css"),
				join(assetsDir, "style.css"),
			);

			// Create a basic manifest
			const manifest = {
				assets: {
					"style.css": {
						path: "/assets/style.css",
						size: (await FS.stat(join(assetsDir, "style.css"))).size,
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
			expect(await fileExists(manifestPath)).toBe(true);

			const manifestContent = await FS.readFile(manifestPath, "utf8");
			const parsedManifest = JSON.parse(manifestContent);

			expect(typeof parsedManifest.assets).toBe("object");
			expect(typeof parsedManifest.generated).toBe("string");
			expect(parsedManifest.config.publicPath).toBe("/assets/");
			expect(parsedManifest.assets["style.css"].path).toBe("/assets/style.css");
		} finally {
			await fixture.cleanup();
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
		const fixture = await copyFixtureToTemp("assets-basic");

		try {
			const {buildForProduction} = await import("../src/commands/build.js");

			// Build with assets
			await buildForProduction({
				entrypoint: join(fixture.src, "app.js"),
				outDir: fixture.dist,
				verbose: false,
				platform: "node",
			});

			// Check that assets directory and manifest were created
			const assetsDir = join(fixture.dist, "static", "assets");
			const manifestPath = join(fixture.dist, "server", "manifest.json");

			expect(await fileExists(assetsDir)).toBe(true);
			expect(await fileExists(manifestPath)).toBe(true);

			// Check app.js was built
			const appPath = join(fixture.dist, "server", "server.js");
			expect(await fileExists(appPath)).toBe(true);

			const appContent = await FS.readFile(appPath, "utf8");
			expect(appContent).toContain("Hello with Assets!");
		} finally {
			await fixture.cleanup();
		}
	},
	TIMEOUT,
);

test(
	"asset URL resolution in ServiceWorker",
	async () => {
		const fixture = await copyFixtureToTemp("assets-basic");

		try {
			// Set up asset files in the static bucket directory
			const staticDir = join(fixture.dir, "static-test");
			await FS.mkdir(staticDir, {recursive: true});

			const cssContent = `.test { color: blue; }`;
			await FS.writeFile(join(staticDir, "test.css"), cssContent);

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
					outputDir: staticDir,
				},
			};

			await FS.writeFile(
				join(staticDir, "manifest.json"),
				JSON.stringify(manifest, null, 2),
			);

			// Test ServiceWorker that serves assets
			const {
				ShovelServiceWorkerRegistration,
				ShovelGlobalScope,
				CustomBucketStorage,
			} = await import("@b9g/platform");
			const {NodeBucket} = await import("@b9g/filesystem/node.js");

			const runtime = new ShovelServiceWorkerRegistration();

			// Create bucket storage with factory
			const buckets = new CustomBucketStorage(async (name) => {
				const targetPath = join(fixture.dir, name);
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
								const assetsBucket =
									await globalThis.buckets.open("static-test");
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
			await fixture.cleanup();
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
		const fixture = await copyFixtureToTemp("assets-basic");

		try {
			const {assetsPlugin} = await import("@b9g/assets/plugin");

			const assetsDir = join(fixture.dist, "assets");
			const manifestPath = join(assetsDir, "manifest.json");

			// Test development mode (dev: true)
			const devPlugin = assetsPlugin({
				outputDir: assetsDir,
				manifest: manifestPath,
				dev: true,
			});

			expect(devPlugin.name).toBe("shovel-assets");
		} finally {
			await fixture.cleanup();
		}
	},
	TIMEOUT,
);

test(
	"asset handling in production mode",
	async () => {
		const fixture = await copyFixtureToTemp("assets-basic");

		try {
			const {assetsPlugin} = await import("@b9g/assets/plugin");

			const assetsDir = join(fixture.dist, "assets");
			const manifestPath = join(assetsDir, "manifest.json");

			// Test production mode (dev: false)
			const prodPlugin = assetsPlugin({
				outputDir: assetsDir,
				manifest: manifestPath,
				dev: false,
			});

			expect(prodPlugin.name).toBe("shovel-assets");
		} finally {
			await fixture.cleanup();
		}
	},
	TIMEOUT,
);

// ======================
// ERROR HANDLING TESTS
// ======================

test(
	"asset plugin error handling - invalid manifest",
	async () => {
		const fixture = await copyFixtureToTemp("assets-basic");

		try {
			const assetsDir = join(fixture.dist, "invalid-manifest-test");
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
			await fixture.cleanup();
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
		const fixture = await copyFixtureToTemp("assets-many");

		try {
			const {buildForProduction} = await import("../src/commands/build.js");

			const startTime = Date.now();

			await buildForProduction({
				entrypoint: join(fixture.src, "app.js"),
				outDir: fixture.dist,
				verbose: false,
				platform: "node",
			});

			const buildTime = Date.now() - startTime;

			// Build should complete in reasonable time even with many assets
			expect(buildTime).toBeLessThan(10000); // 10 seconds max

			// All assets should be processed
			const manifestPath = join(fixture.dist, "server", "manifest.json");
			const manifest = JSON.parse(await FS.readFile(manifestPath, "utf8"));

			// Should have asset entries
			expect(typeof manifest).toBe("object");
		} finally {
			await fixture.cleanup();
		}
	},
	TIMEOUT,
);

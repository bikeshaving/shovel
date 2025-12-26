import {test, expect, describe, beforeEach} from "bun:test";
import {assets} from "@b9g/assets/middleware";
import {assetsPlugin} from "../src/plugins/assets.js";
import {Router} from "@b9g/router";
import {MemoryDirectory} from "@b9g/filesystem/memory";
import {CustomDirectoryStorage} from "@b9g/filesystem";
import * as ESBuild from "esbuild";
import {
	mkdtemp,
	writeFile,
	readdir,
	readFile,
	access,
	mkdir,
} from "fs/promises";
import {tmpdir} from "os";
import {join} from "path";

// Helper to check if path exists
async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch (_err: unknown) {
		// ENOENT is expected when path doesn't exist
		return false;
	}
}

describe("Assets Plugin - output path structure", () => {
	test("should output assets to {outDir}/public/{assetBase}/", async () => {
		const testDir = await mkdtemp(join(tmpdir(), "asset-path-test-"));

		// Create CSS and JS files
		await writeFile(join(testDir, "style.css"), `body { color: red; }`);
		await writeFile(join(testDir, "client.js"), `console.log("hi");`);

		// Create entry that imports with different assetBase paths
		await writeFile(
			join(testDir, "entry.js"),
			`import cssUrl from "./style.css" with { assetBase: "/assets" };
import jsUrl from "./client.js" with { assetBase: "/scripts" };
export { cssUrl, jsUrl };`,
		);

		const outDir = join(testDir, "dist");
		await ESBuild.build({
			entryPoints: [join(testDir, "entry.js")],
			bundle: true,
			format: "esm",
			outdir: join(outDir, "server"),
			write: true,
			plugins: [
				assetsPlugin({
					outDir: outDir,
				}),
			],
		});

		// Assets should be in {outDir}/public/{assetBase}/
		const assetsFiles = await readdir(join(outDir, "public", "assets"));
		expect(assetsFiles.some((f) => f.endsWith(".css"))).toBe(true);

		const scriptsFiles = await readdir(join(outDir, "public", "scripts"));
		expect(scriptsFiles.some((f) => f.endsWith(".js"))).toBe(true);

		// Manifest should be in {outDir}/server/
		const manifest = JSON.parse(
			await readFile(join(outDir, "server", "assets.json"), "utf8"),
		);
		expect(Object.keys(manifest.assets).length).toBe(2);

		// Check URLs in manifest match the assetBase
		const urls = Object.values(manifest.assets).map((a: any) => a.url);
		expect(urls.some((url: string) => url.startsWith("/assets/"))).toBe(true);
		expect(urls.some((url: string) => url.startsWith("/scripts/"))).toBe(true);
	});

	test("should NOT create assets directly under outDir", async () => {
		const testDir = await mkdtemp(join(tmpdir(), "asset-nodir-test-"));

		await writeFile(join(testDir, "style.css"), `body { color: red; }`);
		await writeFile(
			join(testDir, "entry.js"),
			`import cssUrl from "./style.css" with { assetBase: "/assets" };
export { cssUrl };`,
		);

		const outDir = join(testDir, "dist");
		await ESBuild.build({
			entryPoints: [join(testDir, "entry.js")],
			bundle: true,
			format: "esm",
			outdir: join(outDir, "server"),
			write: true,
			plugins: [
				assetsPlugin({
					outDir: outDir,
				}),
			],
		});

		// dist/assets should NOT exist (it should be dist/public/assets)
		const assetsExistDirectly = await pathExists(join(outDir, "assets"));
		expect(assetsExistDirectly).toBe(false);

		// dist/public/assets SHOULD exist
		const staticAssetsFiles = await readdir(join(outDir, "public", "assets"));
		expect(staticAssetsFiles.length).toBeGreaterThan(0);
	});
});

describe("Assets Plugin - assetName attribute", () => {
	test("should use exact assetName when provided", async () => {
		const testDir = await mkdtemp(join(tmpdir(), "asset-name-test-"));

		// Create a favicon
		await writeFile(join(testDir, "my-favicon.ico"), "fake ico content");

		await writeFile(
			join(testDir, "entry.js"),
			`import faviconUrl from "./my-favicon.ico" with { assetBase: "/", assetName: "favicon.ico" };
export { faviconUrl };`,
		);

		const outDir = join(testDir, "dist");
		await ESBuild.build({
			entryPoints: [join(testDir, "entry.js")],
			bundle: true,
			format: "esm",
			outdir: join(outDir, "server"),
			write: true,
			plugins: [
				assetsPlugin({
					outDir: outDir,
				}),
			],
		});

		// File should be exactly "favicon.ico" at root of static
		const rootFiles = await readdir(join(outDir, "public"));
		expect(rootFiles).toContain("favicon.ico");

		// Check manifest URL
		const manifest = JSON.parse(
			await readFile(join(outDir, "server", "assets.json"), "utf8"),
		);
		const assetKey = Object.keys(manifest.assets)[0];
		expect(manifest.assets[assetKey].url).toBe("/favicon.ico");
	});

	test("should work with side-effect only imports (no URL reference)", async () => {
		const testDir = await mkdtemp(join(tmpdir(), "asset-sideeffect-test-"));

		await writeFile(join(testDir, "favicon.ico"), "fake ico content");

		// Import without using the URL - just for side effect of copying the file
		await writeFile(
			join(testDir, "entry.js"),
			`import "./favicon.ico" with { assetBase: "/", assetName: "favicon.ico" };
console.log("app loaded");`,
		);

		const outDir = join(testDir, "dist");
		await ESBuild.build({
			entryPoints: [join(testDir, "entry.js")],
			bundle: true,
			format: "esm",
			outdir: join(outDir, "server"),
			write: true,
			plugins: [
				assetsPlugin({
					outDir: outDir,
				}),
			],
		});

		// File should still be copied even without URL reference
		const rootFiles = await readdir(join(outDir, "public"));
		expect(rootFiles).toContain("favicon.ico");
	});

	test("should support [name] and [ext] placeholders in assetName", async () => {
		const testDir = await mkdtemp(join(tmpdir(), "asset-placeholder-test-"));

		await writeFile(join(testDir, "photo.png"), "fake png content");

		await writeFile(
			join(testDir, "entry.js"),
			`import imgUrl from "./photo.png" with { assetBase: "/images/", assetName: "[name].[ext]" };
export { imgUrl };`,
		);

		const outDir = join(testDir, "dist");
		await ESBuild.build({
			entryPoints: [join(testDir, "entry.js")],
			bundle: true,
			format: "esm",
			outdir: join(outDir, "server"),
			write: true,
			plugins: [
				assetsPlugin({
					outDir: outDir,
				}),
			],
		});

		// File should be "photo.png" in public/images/
		const imageFiles = await readdir(join(outDir, "public", "images"));
		expect(imageFiles).toContain("photo.png");

		// Check manifest URL
		const manifest = JSON.parse(
			await readFile(join(outDir, "server", "assets.json"), "utf8"),
		);
		const assetKey = Object.keys(manifest.assets)[0];
		expect(manifest.assets[assetKey].url).toBe("/images/photo.png");
	});
});

describe("Assets Plugin - TypeScript transpilation", () => {
	test("should transpile TypeScript files to JavaScript", async () => {
		const testDir = await mkdtemp(join(tmpdir(), "ts-asset-test-"));

		// Create a TypeScript client file
		await writeFile(
			join(testDir, "client.ts"),
			`const message: string = "Hello"; export {};`,
		);

		// Create entry that imports TS as asset
		await writeFile(
			join(testDir, "entry.js"),
			`import clientUrl from "./client.ts" with { assetBase: "/static" };
export default clientUrl;`,
		);

		const outDir = join(testDir, "dist");
		await ESBuild.build({
			entryPoints: [join(testDir, "entry.js")],
			bundle: true,
			format: "esm",
			outdir: join(outDir, "server"),
			write: true,
			plugins: [
				assetsPlugin({
					outDir: outDir,
				}),
			],
		});

		// Check output files - assets go to {outDir}/public/{assetBase}/
		const files = await readdir(join(outDir, "public", "static"));
		const jsFiles = files.filter((f) => f.endsWith(".js"));

		expect(jsFiles.length).toBe(1);
		expect(jsFiles[0]).toMatch(/^client-[a-f0-9]+\.js$/);

		// Check manifest has correct MIME type
		const manifest = JSON.parse(
			await readFile(join(outDir, "server", "assets.json"), "utf8"),
		);
		const assetKey = Object.keys(manifest.assets)[0];
		expect(manifest.assets[assetKey].type).toBe("application/javascript");
		expect(manifest.assets[assetKey].output).toMatch(/\.js$/);
	});

	test("should preserve non-TS files as-is", async () => {
		const testDir = await mkdtemp(join(tmpdir(), "css-asset-test-"));

		// Create a CSS file
		await writeFile(join(testDir, "style.css"), `body { color: red; }`);

		// Create entry that imports CSS as asset
		await writeFile(
			join(testDir, "entry.js"),
			`import styleUrl from "./style.css" with { assetBase: "/static" };
export default styleUrl;`,
		);

		const outDir = join(testDir, "dist");
		await ESBuild.build({
			entryPoints: [join(testDir, "entry.js")],
			bundle: true,
			format: "esm",
			outdir: join(outDir, "server"),
			write: true,
			plugins: [
				assetsPlugin({
					outDir: outDir,
				}),
			],
		});

		// Check output files - assets go to {outDir}/public/{assetBase}/
		const files = await readdir(join(outDir, "public", "static"));
		const cssFiles = files.filter((f) => f.endsWith(".css"));

		expect(cssFiles.length).toBe(1);
		expect(cssFiles[0]).toMatch(/^style-[a-f0-9]+\.css$/);

		// Check manifest has correct MIME type
		const manifest = JSON.parse(
			await readFile(join(outDir, "server", "assets.json"), "utf8"),
		);
		const assetKey = Object.keys(manifest.assets)[0];
		expect(manifest.assets[assetKey].type).toBe("text/css");
	});
});

describe("Assets Plugin - CSS bundling", () => {
	test("should bundle CSS @import statements", async () => {
		const testDir = await mkdtemp(join(tmpdir(), "css-import-test-"));

		// Create a CSS file that imports another
		await writeFile(join(testDir, "base.css"), `:root { --color: blue; }`);
		await writeFile(
			join(testDir, "style.css"),
			`@import "./base.css";
body { color: var(--color); }`,
		);

		// Create entry that imports CSS as asset
		await writeFile(
			join(testDir, "entry.js"),
			`import styleUrl from "./style.css" with { assetBase: "/static" };
export default styleUrl;`,
		);

		const outDir = join(testDir, "dist");
		await ESBuild.build({
			entryPoints: [join(testDir, "entry.js")],
			bundle: true,
			format: "esm",
			outdir: join(outDir, "server"),
			write: true,
			plugins: [
				assetsPlugin({
					outDir: outDir,
				}),
			],
		});

		// Check output files
		const files = await readdir(join(outDir, "public", "static"));
		const cssFiles = files.filter((f) => f.endsWith(".css"));
		expect(cssFiles.length).toBe(1);

		// Read the output CSS - it should contain both the base and style content
		const outputCSS = await readFile(
			join(outDir, "public", "static", cssFiles[0]),
			"utf8",
		);
		// The @import should be resolved, so the output should contain :root
		expect(outputCSS).toContain("--color");
		// The output should NOT contain @import
		expect(outputCSS).not.toContain("@import");
	});

	test("should bundle CSS from node_modules", async () => {
		const testDir = await mkdtemp(join(tmpdir(), "css-nodemod-test-"));

		// Create a mock node_modules structure
		const nodeModulesDir = join(testDir, "node_modules", "fake-lib");
		await mkdir(nodeModulesDir, {recursive: true});
		await writeFile(
			join(nodeModulesDir, "style.css"),
			`.fake-lib { display: block; }`,
		);

		// Create CSS that imports from node_modules
		await writeFile(
			join(testDir, "style.css"),
			`@import "fake-lib/style.css";
.app { color: red; }`,
		);

		await writeFile(
			join(testDir, "entry.js"),
			`import styleUrl from "./style.css" with { assetBase: "/static" };
export default styleUrl;`,
		);

		const outDir = join(testDir, "dist");
		await ESBuild.build({
			entryPoints: [join(testDir, "entry.js")],
			bundle: true,
			format: "esm",
			outdir: join(outDir, "server"),
			write: true,
			plugins: [
				assetsPlugin({
					outDir: outDir,
				}),
			],
		});

		// Check the bundled CSS contains both
		const files = await readdir(join(outDir, "public", "static"));
		const cssFiles = files.filter((f) => f.endsWith(".css"));
		const outputCSS = await readFile(
			join(outDir, "public", "static", cssFiles[0]),
			"utf8",
		);

		expect(outputCSS).toContain(".fake-lib");
		expect(outputCSS).toContain(".app");
	});
});

describe("Assets Plugin - type: css attribute", () => {
	test("should extract CSS from JS bundle with type: css", async () => {
		const testDir = await mkdtemp(join(tmpdir(), "type-css-test-"));

		// Create a CSS file
		await writeFile(join(testDir, "styles.css"), `.app { color: red; }`);

		// Create a TS client that imports CSS
		await writeFile(
			join(testDir, "client.ts"),
			`import "./styles.css";
console.log("client loaded");`,
		);

		// Create entry that imports client with type: css
		await writeFile(
			join(testDir, "entry.js"),
			`import clientCss from "./client.ts" with { assetBase: "/static", type: "css" };
export default clientCss;`,
		);

		const outDir = join(testDir, "dist");
		await ESBuild.build({
			entryPoints: [join(testDir, "entry.js")],
			bundle: true,
			format: "esm",
			outdir: join(outDir, "server"),
			write: true,
			plugins: [
				assetsPlugin({
					outDir: outDir,
				}),
			],
		});

		// Check that a CSS file was output
		const files = await readdir(join(outDir, "public", "static"));
		const cssFiles = files.filter((f) => f.endsWith(".css"));
		expect(cssFiles.length).toBe(1);
		expect(cssFiles[0]).toMatch(/^client-[a-f0-9]+\.css$/);

		// Check manifest has CSS MIME type
		const manifest = JSON.parse(
			await readFile(join(outDir, "server", "assets.json"), "utf8"),
		);
		const assetKey = Object.keys(manifest.assets)[0];
		expect(manifest.assets[assetKey].type).toBe("text/css");
		expect(manifest.assets[assetKey].url).toMatch(/\.css$/);

		// Read the output CSS - should contain the styles
		const outputCSS = await readFile(
			join(outDir, "public", "static", cssFiles[0]),
			"utf8",
		);
		expect(outputCSS).toContain(".app");
	});

	test("should error when using type: css on file with no CSS imports", async () => {
		const testDir = await mkdtemp(join(tmpdir(), "type-css-error-test-"));

		// Create a TS client that does NOT import CSS
		await writeFile(join(testDir, "client.ts"), `console.log("no css here");`);

		await writeFile(
			join(testDir, "entry.js"),
			`import clientCss from "./client.ts" with { assetBase: "/static", type: "css" };
export default clientCss;`,
		);

		const outDir = join(testDir, "dist");

		// Build should fail
		let error: Error | null = null;
		try {
			await ESBuild.build({
				entryPoints: [join(testDir, "entry.js")],
				bundle: true,
				format: "esm",
				outdir: join(outDir, "server"),
				write: true,
				plugins: [
					assetsPlugin({
						outDir: outDir,
					}),
				],
			});
		} catch (e) {
			error = e as Error;
		}

		expect(error).not.toBeNull();
		expect(error!.message).toContain("Build failed");
	});

	test("should error when using type: css on non-transpilable file", async () => {
		const testDir = await mkdtemp(join(tmpdir(), "type-css-png-test-"));

		// Create a PNG file
		await writeFile(join(testDir, "image.png"), "fake png content");

		await writeFile(
			join(testDir, "entry.js"),
			`import imageCss from "./image.png" with { assetBase: "/static", type: "css" };
export default imageCss;`,
		);

		const outDir = join(testDir, "dist");

		// Build should fail
		let error: Error | null = null;
		try {
			await ESBuild.build({
				entryPoints: [join(testDir, "entry.js")],
				bundle: true,
				format: "esm",
				outdir: join(outDir, "server"),
				write: true,
				plugins: [
					assetsPlugin({
						outDir: outDir,
					}),
				],
			});
		} catch (e) {
			error = e as Error;
		}

		expect(error).not.toBeNull();
		expect(error!.message).toContain("Build failed");
	});
});

// Helper to write content to a MemoryDirectory
async function writeToMemoryDirectory(
	directory: MemoryDirectory,
	path: string,
	content: string,
) {
	const handle = await directory.getFileHandle(path, {create: true});
	const writable = await handle.createWritable();
	await writable.write(new TextEncoder().encode(content));
	await writable.close();
}

describe("Assets Middleware", () => {
	const manifest = {
		assets: {
			"/app.js": {
				url: "/app.js",
				type: "application/javascript",
				size: 1234,
				hash: "abc123",
			},
			"/styles.css": {
				url: "/styles.css",
				type: "text/css",
				size: 567,
				hash: "def456",
			},
		},
	};

	beforeEach(async () => {
		const serverDirectory = new MemoryDirectory("server");
		const publicDirectory = new MemoryDirectory("public");

		await writeToMemoryDirectory(
			serverDirectory,
			"assets.json",
			JSON.stringify(manifest),
		);
		await writeToMemoryDirectory(
			publicDirectory,
			"app.js",
			"console.log('app')",
		);
		await writeToMemoryDirectory(publicDirectory, "styles.css", "body{}");

		const directoryStorage = new CustomDirectoryStorage((name: string) => {
			if (name === "server") return Promise.resolve(serverDirectory);
			if (name === "public") return Promise.resolve(publicDirectory);
			throw new Error(`Directory not found: ${name}`);
		});

		(globalThis as any).directories = directoryStorage;
	});

	test("should serve asset from manifest", async () => {
		const router = new Router();
		router.use(assets());
		router.route("/*").get(() => new Response("Not Found", {status: 404}));

		const request = new Request("http://example.com/app.js");
		const response = await router.handle(request);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("application/javascript");
		expect(response.headers.get("Content-Length")).toBe("1234");
		expect(response.headers.get("ETag")).toBe('"abc123"');
	});

	test("should pass through to next middleware for non-existent asset", async () => {
		const router = new Router();
		router.use(assets());
		router.route("/*").get(() => new Response("Not Found", {status: 404}));

		const request = new Request("http://example.com/nonexistent.js");
		const response = await router.handle(request);

		// Should pass through to 404 handler
		expect(response.status).toBe(404);
	});

	test("should block directory traversal with double slash", async () => {
		const router = new Router();
		router.use(assets());
		router.route("/*").get(() => new Response("Not Found", {status: 404}));

		const request = new Request("http://example.com//etc/passwd");
		const response = await router.handle(request);

		expect(response.status).toBe(403);
		expect(await response.text()).toBe("Forbidden");
	});

	test("should handle conditional requests with 304", async () => {
		const router = new Router();
		router.use(assets());
		router.route("/*").get(() => new Response("Not Found", {status: 404}));

		const futureDate = new Date(Date.now() + 100000).toUTCString();
		const request = new Request("http://example.com/app.js", {
			headers: {"if-modified-since": futureDate},
		});
		const response = await router.handle(request);

		expect(response.status).toBe(304);
	});

	test("should detect MIME type from extension when manifest type not present", async () => {
		// Override with manifest that has no type field
		const serverDirectory = new MemoryDirectory("server");
		const publicDirectory = new MemoryDirectory("public");

		const noTypeManifest = {
			assets: {
				"/app.js": {url: "/app.js", size: 1234, hash: "abc123"}, // No type
			},
		};
		await writeToMemoryDirectory(
			serverDirectory,
			"assets.json",
			JSON.stringify(noTypeManifest),
		);
		await writeToMemoryDirectory(
			publicDirectory,
			"app.js",
			"console.log('app')",
		);

		const directoryStorage = new CustomDirectoryStorage((name: string) => {
			if (name === "server") return Promise.resolve(serverDirectory);
			if (name === "public") return Promise.resolve(publicDirectory);
			throw new Error(`Directory not found: ${name}`);
		});

		(globalThis as any).directories = directoryStorage;

		const router = new Router();
		router.use(assets());
		router.route("/*").get(() => new Response("Not Found", {status: 404}));

		const request = new Request("http://example.com/app.js");
		const response = await router.handle(request);

		// Should detect text/javascript from .js extension
		expect(response.headers.get("Content-Type")).toBe("text/javascript");
	});

	test("should set custom cache headers", async () => {
		const router = new Router();
		router.use(
			assets({
				cacheControl: "no-cache",
			}),
		);
		router.route("/*").get(() => new Response("Not Found", {status: 404}));

		const request = new Request("http://example.com/app.js");
		const response = await router.handle(request);

		expect(response.headers.get("Cache-Control")).toBe("no-cache");
	});
});

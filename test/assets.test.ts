import {test, expect, describe, beforeEach} from "bun:test";
import {assetsPlugin} from "../src/plugins/assets.js";
import {assets} from "../packages/assets/src/middleware.js";
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
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			return false;
		}
		throw err;
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

describe("Assets Plugin - user plugins", () => {
	test("should NOT be blocked by user plugins in main build when processing assetBase imports", async () => {
		// This test verifies the bug where user plugins (like PostCSS) added to the main
		// build intercept CSS files BEFORE the assets plugin can process them.
		// The assets plugin should handle all files with { assetBase: "..." } imports,
		// not user plugins in the main build.
		const testDir = await mkdtemp(join(tmpdir(), "plugin-intercept-test-"));

		// Create CSS with nested @media (requires PostCSS to transform)
		await writeFile(
			join(testDir, "style.css"),
			`pre {
  padding: 5px;
  @media screen and (min-width: 800px) {
    padding: 1em;
  }
}`,
		);

		await writeFile(
			join(testDir, "entry.js"),
			`import styleUrl from "./style.css" with { assetBase: "/static/" };
export default styleUrl;`,
		);

		// Simulate a CSS plugin like PostCSS that processes ALL CSS files
		// and returns a result (never returning null)
		const cssInterceptorPlugin: ESBuild.Plugin = {
			name: "css-interceptor",
			setup(build) {
				build.onLoad({filter: /\.css$/}, async (args) => {
					// This simulates what esbuild-postcss does - it processes ALL CSS
					// and always returns a result, never passing through to other plugins
					const content = await readFile(args.path, "utf8");
					// Transform nested @media to proper CSS (like PostCSS does)
					const transformed = content.replace(
						/@media ([^{]+)\{([^}]+)\}/g,
						"}\n@media $1{ pre {$2} }",
					);
					return {contents: transformed, loader: "css"};
				});
			},
		};

		const outDir = join(testDir, "dist");

		// assetsPlugin runs FIRST to intercept { assetBase } imports.
		// User plugins run AFTER, so they can handle files without assetBase
		// (e.g., .glsl files used directly in server code).
		await ESBuild.build({
			entryPoints: [join(testDir, "entry.js")],
			bundle: true,
			format: "esm",
			outdir: join(outDir, "server"),
			write: true,
			plugins: [
				// assetsPlugin comes first - intercepts assetBase imports
				assetsPlugin({
					outDir: outDir,
					plugins: [cssInterceptorPlugin],
				}),
				// User plugins come after - handle everything else
				cssInterceptorPlugin,
			],
		});

		// The CSS should be in the manifest and in public/static/
		const manifest = JSON.parse(
			await readFile(join(outDir, "server", "assets.json"), "utf8"),
		);

		// Find the CSS asset
		const cssAsset = Object.values(manifest.assets).find((a: any) =>
			a.url?.endsWith(".css"),
		);

		expect(cssAsset).toBeDefined();
		expect((cssAsset as any).url).toMatch(/^\/static\//);

		// Verify the CSS file exists in public/static/
		const files = await readdir(join(outDir, "public", "static"));
		const cssFiles = files.filter((f) => f.endsWith(".css"));
		expect(cssFiles.length).toBe(1);
	});

	test("should apply user plugins to CSS bundling", async () => {
		const testDir = await mkdtemp(join(tmpdir(), "css-plugin-test-"));

		// Create CSS with content that our test plugin will transform
		await writeFile(join(testDir, "style.css"), `body { color: REPLACE_ME; }`);

		await writeFile(
			join(testDir, "entry.js"),
			`import styleUrl from "./style.css" with { assetBase: "/static" };
export default styleUrl;`,
		);

		// Create a simple plugin that transforms CSS content
		const testPlugin: ESBuild.Plugin = {
			name: "test-css-transform",
			setup(build) {
				build.onLoad({filter: /\.css$/}, async (args) => {
					const content = await readFile(args.path, "utf8");
					const transformed = content.replace("REPLACE_ME", "green");
					return {contents: transformed, loader: "css"};
				});
			},
		};

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
					plugins: [testPlugin],
				}),
			],
		});

		// Check the bundled CSS was transformed by our plugin
		const files = await readdir(join(outDir, "public", "static"));
		const cssFiles = files.filter((f) => f.endsWith(".css"));
		expect(cssFiles.length).toBe(1);

		const outputCSS = await readFile(
			join(outDir, "public", "static", cssFiles[0]),
			"utf8",
		);

		// Plugin should have replaced REPLACE_ME with green
		expect(outputCSS).toContain("green");
		expect(outputCSS).not.toContain("REPLACE_ME");
	});

	test("should apply user plugins to JS/TS transpilation", async () => {
		const testDir = await mkdtemp(join(tmpdir(), "js-plugin-test-"));

		// Create TS with content that our test plugin will transform
		await writeFile(
			join(testDir, "client.ts"),
			`const msg: string = "REPLACE_ME"; console.log(msg);`,
		);

		await writeFile(
			join(testDir, "entry.js"),
			`import clientUrl from "./client.ts" with { assetBase: "/static" };
export default clientUrl;`,
		);

		// Create a simple plugin that transforms JS content
		const testPlugin: ESBuild.Plugin = {
			name: "test-js-transform",
			setup(build) {
				build.onLoad({filter: /\.ts$/}, async (args) => {
					const content = await readFile(args.path, "utf8");
					const transformed = content.replace("REPLACE_ME", "transformed");
					return {contents: transformed, loader: "ts"};
				});
			},
		};

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
					plugins: [testPlugin],
				}),
			],
		});

		// Check the bundled JS was transformed by our plugin
		const files = await readdir(join(outDir, "public", "static"));
		const jsFiles = files.filter((f) => f.endsWith(".js"));
		expect(jsFiles.length).toBe(1);

		const outputJS = await readFile(
			join(outDir, "public", "static", jsFiles[0]),
			"utf8",
		);

		// Plugin should have replaced REPLACE_ME with transformed
		expect(outputJS).toContain("transformed");
		expect(outputJS).not.toContain("REPLACE_ME");
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

describe("Assets Plugin - code splitting", () => {
	test("should create separate chunks for dynamic imports", async () => {
		const testDir = await mkdtemp(join(tmpdir(), "code-splitting-test-"));

		// Create a "heavy" module that will be dynamically imported
		await writeFile(
			join(testDir, "heavy-dep.ts"),
			`export const data = "heavy data"; export const compute = () => data.toUpperCase();`,
		);

		// Create a client file with a dynamic import
		await writeFile(
			join(testDir, "client.ts"),
			`
const condition = Math.random() > 0.5;
if (condition) {
	const { data } = await import("./heavy-dep.ts");
	console.log(data);
}
export {};
`,
		);

		// Create entry that imports the client as asset
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

		// Check output files - should have entry + chunk(s)
		const files = await readdir(join(outDir, "public", "static"));
		const jsFiles = files.filter((f) => f.endsWith(".js"));

		// Should have at least 2 JS files (entry + chunk)
		expect(jsFiles.length).toBeGreaterThanOrEqual(2);

		// Should have the entry file
		const entryFile = jsFiles.find((f) => f.startsWith("client-"));
		expect(entryFile).toBeDefined();

		// Should have chunk file(s) — esbuild names chunks after the source module, not "chunk-"
		const chunkFiles = jsFiles.filter((f) => f !== entryFile);
		expect(chunkFiles.length).toBeGreaterThanOrEqual(1);

		// Check manifest contains entry file
		const manifest = JSON.parse(
			await readFile(join(outDir, "server", "assets.json"), "utf8"),
		);

		// Entry file should be in manifest with source path
		const entryAsset = Object.values(manifest.assets).find(
			(a: any) => a.output === entryFile,
		);
		expect(entryAsset).toBeDefined();
		expect((entryAsset as any).type).toBe("application/javascript");

		// Chunk files should also be in manifest (keyed by URL)
		for (const chunkFile of chunkFiles) {
			const chunkUrl = `/static/${chunkFile}`;
			const chunkAsset = manifest.assets[chunkUrl];
			expect(chunkAsset).toBeDefined();
			expect(chunkAsset.url).toBe(chunkUrl);
			expect(chunkAsset.type).toBe("application/javascript");
		}
	});

	test("should work without dynamic imports (no chunks)", async () => {
		const testDir = await mkdtemp(join(tmpdir(), "no-splitting-test-"));

		// Create a simple client with no dynamic imports
		await writeFile(
			join(testDir, "client.ts"),
			`const msg: string = "Hello"; console.log(msg); export {};`,
		);

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

		// Check output files - should have only entry file
		const files = await readdir(join(outDir, "public", "static"));
		const jsFiles = files.filter((f) => f.endsWith(".js"));

		// Should have exactly 1 JS file (entry only)
		expect(jsFiles.length).toBe(1);
		expect(jsFiles[0]).toMatch(/^client-[a-f0-9]+\.js$/);

		// Check manifest
		const manifest = JSON.parse(
			await readFile(join(outDir, "server", "assets.json"), "utf8"),
		);
		expect(Object.keys(manifest.assets).length).toBe(1);
	});

	test("should include CSS from dynamic imports when using type: css", async () => {
		const testDir = await mkdtemp(join(tmpdir(), "css-dynamic-import-test-"));

		// Create CSS for the main module
		await writeFile(join(testDir, "main.css"), `.main { color: red; }`);

		// Create CSS for the dynamically imported module
		await writeFile(join(testDir, "lazy.css"), `.lazy { color: blue; }`);

		// Create the lazy module that imports its own CSS
		await writeFile(
			join(testDir, "lazy.ts"),
			`import "./lazy.css";
export const lazyData = "lazy";`,
		);

		// Create the main client that imports main CSS and dynamically imports lazy
		await writeFile(
			join(testDir, "client.ts"),
			`import "./main.css";
const condition = true;
if (condition) {
	const { lazyData } = await import("./lazy.ts");
	console.log(lazyData);
}
export {};`,
		);

		// Import with type: "css" to extract all CSS
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

		// Check CSS output contains both main and lazy styles
		const files = await readdir(join(outDir, "public", "static"));
		const cssFiles = files.filter((f) => f.endsWith(".css"));
		expect(cssFiles.length).toBeGreaterThanOrEqual(1);

		// Read all CSS content
		let allCSS = "";
		for (const cssFile of cssFiles) {
			allCSS += await readFile(
				join(outDir, "public", "static", cssFile),
				"utf8",
			);
		}

		// Both .main and .lazy styles should be present
		expect(allCSS).toContain(".main");
		expect(allCSS).toContain(".lazy");
	});

	test("should use unique manifest keys for chunks across different assetBase imports", async () => {
		const testDir = await mkdtemp(join(tmpdir(), "chunk-manifest-key-test-"));

		// Create a shared module that will become a chunk
		await writeFile(
			join(testDir, "shared.ts"),
			`export const sharedData = "shared";`,
		);

		// Create two clients that dynamically import the same shared module
		await writeFile(
			join(testDir, "client-a.ts"),
			`if (true) { const { sharedData } = await import("./shared.ts"); console.log(sharedData); }
export {};`,
		);

		await writeFile(
			join(testDir, "client-b.ts"),
			`if (true) { const { sharedData } = await import("./shared.ts"); console.log(sharedData); }
export {};`,
		);

		// Import both clients with different assetBase paths
		await writeFile(
			join(testDir, "entry.js"),
			`import clientA from "./client-a.ts" with { assetBase: "/assets-a" };
import clientB from "./client-b.ts" with { assetBase: "/assets-b" };
export { clientA, clientB };`,
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

		// Check both directories have their chunk files
		const assetsAFiles = await readdir(join(outDir, "public", "assets-a"));
		const assetsBFiles = await readdir(join(outDir, "public", "assets-b"));

		// Chunks are named after the source module, not "chunk-" — filter out the entry files
		const chunksA = assetsAFiles.filter(
			(f) => f.endsWith(".js") && !f.startsWith("client-a-"),
		);
		const chunksB = assetsBFiles.filter(
			(f) => f.endsWith(".js") && !f.startsWith("client-b-"),
		);

		expect(chunksA.length).toBeGreaterThanOrEqual(1);
		expect(chunksB.length).toBeGreaterThanOrEqual(1);

		// Check manifest has entries for chunks in BOTH directories
		const manifest = JSON.parse(
			await readFile(join(outDir, "server", "assets.json"), "utf8"),
		);

		// Find chunk entries for each assetBase (non-entry JS files)
		const chunkEntriesA = Object.values(manifest.assets).filter(
			(a: any) =>
				a.url?.startsWith("/assets-a/") &&
				a.url?.endsWith(".js") &&
				!a.url?.includes("/client-a-"),
		);
		const chunkEntriesB = Object.values(manifest.assets).filter(
			(a: any) =>
				a.url?.startsWith("/assets-b/") &&
				a.url?.endsWith(".js") &&
				!a.url?.includes("/client-b-"),
		);

		// Both should have their chunk entries preserved (not overwritten)
		expect(chunkEntriesA.length).toBeGreaterThanOrEqual(1);
		expect(chunkEntriesB.length).toBeGreaterThanOrEqual(1);
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
	// Test manifest passed directly to middleware
	const testManifest = {
		assets: {
			"/app.js": {
				source: "app.js",
				output: "app.js",
				url: "/app.js",
				type: "application/javascript",
				size: 1234,
				hash: "abc123",
			},
			"/styles.css": {
				source: "styles.css",
				output: "styles.css",
				url: "/styles.css",
				type: "text/css",
				size: 567,
				hash: "def456",
			},
		},
		generated: new Date().toISOString(),
		config: {outDir: "dist"},
	};

	beforeEach(async () => {
		const publicDirectory = new MemoryDirectory("public");

		await writeToMemoryDirectory(
			publicDirectory,
			"app.js",
			"console.log('app')",
		);
		await writeToMemoryDirectory(publicDirectory, "styles.css", "body{}");

		const directoryStorage = new CustomDirectoryStorage((name: string) => {
			if (name === "public") return Promise.resolve(publicDirectory);
			throw new Error(`Directory not found: ${name}`);
		});

		(globalThis as any).directories = directoryStorage;
	});

	test("should serve asset from manifest", async () => {
		const router = new Router();
		router.use(assets({manifest: testManifest}));
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
		router.use(assets({manifest: testManifest}));
		router.route("/*").get(() => new Response("Not Found", {status: 404}));

		const request = new Request("http://example.com/nonexistent.js");
		const response = await router.handle(request);

		// Should pass through to 404 handler
		expect(response.status).toBe(404);
	});

	test("should block directory traversal with double slash", async () => {
		const router = new Router();
		router.use(assets({manifest: testManifest}));
		router.route("/*").get(() => new Response("Not Found", {status: 404}));

		const request = new Request("http://example.com//etc/passwd");
		const response = await router.handle(request);

		expect(response.status).toBe(403);
		expect(await response.text()).toBe("Forbidden");
	});

	test("should handle conditional requests with 304", async () => {
		const router = new Router();
		router.use(assets({manifest: testManifest}));
		router.route("/*").get(() => new Response("Not Found", {status: 404}));

		const futureDate = new Date(Date.now() + 100000).toUTCString();
		const request = new Request("http://example.com/app.js", {
			headers: {"if-modified-since": futureDate},
		});
		const response = await router.handle(request);

		expect(response.status).toBe(304);
	});

	test("should detect MIME type from extension when manifest type not present", async () => {
		// Manifest with entry that has no type field
		const noTypeManifest = {
			assets: {
				"/app.js": {
					source: "app.js",
					output: "app.js",
					url: "/app.js",
					size: 1234,
					hash: "abc123",
				},
			},
			generated: new Date().toISOString(),
			config: {outDir: "dist"},
		};

		const router = new Router();
		router.use(assets({manifest: noTypeManifest}));
		router.route("/*").get(() => new Response("Not Found", {status: 404}));

		const request = new Request("http://example.com/app.js");
		const response = await router.handle(request);

		// Should detect text/javascript from .js extension (via Mime library)
		expect(response.headers.get("Content-Type")).toBe("text/javascript");
	});

	test("should set custom cache headers", async () => {
		const router = new Router();
		router.use(
			assets({
				manifest: testManifest,
				cacheControl: "no-cache",
			}),
		);
		router.route("/*").get(() => new Response("Not Found", {status: 404}));

		const request = new Request("http://example.com/app.js");
		const response = await router.handle(request);

		expect(response.headers.get("Cache-Control")).toBe("no-cache");
	});
});

/* eslint-disable no-restricted-properties -- Tests need process.cwd */
import * as FS from "fs/promises";
import {join} from "path";
import {test, expect} from "bun:test";
import {Miniflare} from "miniflare";
import {buildForProduction} from "../src/commands/build.js";
import {copyFixtureToTemp, fileExists} from "./utils.js";

/**
 * Cloudflare-specific build tests
 * Copies fixtures to temp directories for test isolation.
 */

const TIMEOUT = 10000;
const MINIFLARE_TIMEOUT = 30000;

/**
 * Create a Miniflare instance with retry for flaky workerd spawns on CI.
 */
async function createMiniflare(options, retries = 3) {
	let lastErr;
	for (let i = 0; i < retries; i++) {
		let mf;
		try {
			mf = new Miniflare(options);
			await mf.ready;
			return mf;
		} catch (err) {
			lastErr = err;
			try {
				if (mf) await mf.dispose();
			} catch (_disposeErr) {
				// ignore dispose errors
			}
			if (i < retries - 1) {
				await new Promise((r) => setTimeout(r, 1000));
			}
		}
	}
	throw lastErr;
}

test(
	"cloudflare build - basic ServiceWorker",
	async () => {
		const fixture = await copyFixtureToTemp("cloudflare-basic");

		try {
			await buildForProduction({
				entrypoint: join(fixture.src, "app.js"),
				outDir: fixture.dist,
				verbose: false,
				platform: "cloudflare",
			});

			// Verify output files exist
			expect(await fileExists(join(fixture.dist, "server", "worker.js"))).toBe(
				true,
			);
			expect(
				await fileExists(join(fixture.dist, "server", "package.json")),
			).toBe(true);
			expect(
				await fileExists(join(fixture.dist, "server", "assets.json")),
			).toBe(true);

			// Verify Cloudflare-specific output
			const serverContent = await FS.readFile(
				join(fixture.dist, "server", "worker.js"),
				"utf8",
			);

			// Cloudflare builds should NOT have shebang (browser environment)
			expect(serverContent.startsWith("#!/usr/bin/env")).toBe(false);

			// Should contain the ServiceWorker code
			expect(serverContent).toContain("Hello from Cloudflare!");
			expect(serverContent).toContain("addEventListener");
		} finally {
			await fixture.cleanup();
		}
	},
	TIMEOUT,
);

test(
	"cloudflare build - should not hang with esbuild context cleanup",
	async () => {
		const fixture = await copyFixtureToTemp("cloudflare-basic");

		try {
			// This test verifies the build completes without hanging
			// The timeout will fail if the build hangs
			const startTime = Date.now();

			await buildForProduction({
				entrypoint: join(fixture.src, "app.js"),
				outDir: fixture.dist,
				verbose: false,
				platform: "cloudflare",
			});

			const buildTime = Date.now() - startTime;

			// Build should complete quickly (less than 5 seconds)
			expect(buildTime).toBeLessThan(5000);

			// Verify output was created
			expect(await fileExists(join(fixture.dist, "server", "worker.js"))).toBe(
				true,
			);
		} finally {
			await fixture.cleanup();
		}
	},
	TIMEOUT,
);

test(
	"cloudflare build - with assets",
	async () => {
		const fixture = await copyFixtureToTemp("cloudflare-assets");

		try {
			await buildForProduction({
				entrypoint: join(fixture.src, "app.js"),
				outDir: fixture.dist,
				verbose: false,
				platform: "cloudflare",
			});

			// Verify output structure
			expect(await fileExists(join(fixture.dist, "server", "worker.js"))).toBe(
				true,
			);
			expect(await fileExists(join(fixture.dist, "public", "assets"))).toBe(
				true,
			);
			expect(
				await fileExists(join(fixture.dist, "server", "assets.json")),
			).toBe(true);

			// Verify manifest contains the asset
			const manifestContent = await FS.readFile(
				join(fixture.dist, "server", "assets.json"),
				"utf8",
			);
			const manifest = JSON.parse(manifestContent);
			expect(Object.keys(manifest.assets).length).toBeGreaterThan(0);
		} finally {
			await fixture.cleanup();
		}
	},
	TIMEOUT,
);

test(
	"cloudflare build - worker with lifecycle runs in Miniflare",
	async () => {
		const fixture = await copyFixtureToTemp("cloudflare-lifecycle");
		let mf;

		try {
			// Build the worker
			await buildForProduction({
				entrypoint: join(fixture.src, "app.js"),
				outDir: fixture.dist,
				verbose: false,
				platform: "cloudflare",
			});

			const workerPath = join(fixture.dist, "server", "worker.js");
			expect(await fileExists(workerPath)).toBe(true);

			// Read script content (scriptPath has issues with symlinked dirs)
			const script = await FS.readFile(workerPath, "utf8");

			// Load and run the worker in Miniflare
			// This will fail if setTimeout is called in global scope during lifecycle
			mf = await createMiniflare({
				modules: true,
				script,
				compatibilityDate: "2024-09-23",
				compatibilityFlags: ["nodejs_compat"],
			});

			// Send a request to the worker
			const response = await mf.dispatchFetch("http://localhost/");
			expect(response.status).toBe(200);

			const body = await response.json();
			expect(body.message).toBe("Hello from Cloudflare with lifecycle!");
			expect(body.installed).toBe(true);
			expect(body.activated).toBe(true);
		} finally {
			if (mf) {
				await mf.dispose();
			}
			await fixture.cleanup();
		}
	},
	MINIFLARE_TIMEOUT,
);

test(
	"cloudflare build - glob asset imports served via Miniflare",
	async () => {
		const tempDir = join(
			(await import("os")).tmpdir(),
			`shovel-cf-glob-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		);
		await FS.mkdir(tempDir, {recursive: true});
		let mf;

		try {
			// Create static files
			await FS.mkdir(join(tempDir, "public"), {recursive: true});
			await FS.writeFile(join(tempDir, "public", "logo.txt"), "I am a logo");
			await FS.mkdir(join(tempDir, "public", "images"), {recursive: true});
			await FS.writeFile(
				join(tempDir, "public", "images", "hero.txt"),
				"hero image",
			);

			// Entry point: glob import + assets middleware + URL map route
			await FS.writeFile(
				join(tempDir, "app.js"),
				`
import urls from "./public/**/*" with { assetBase: "/", assetName: "[name].[ext]" };

self.addEventListener("fetch", (event) => {
	event.respondWith(Response.json(urls));
});
`,
			);

			await FS.writeFile(
				join(tempDir, "package.json"),
				JSON.stringify({name: "test-cf-glob", type: "module"}),
			);

			await FS.symlink(
				join(process.cwd(), "node_modules"),
				join(tempDir, "node_modules"),
				"dir",
			);

			const outDir = join(tempDir, "dist");
			const originalCwd = process.cwd();
			process.chdir(tempDir);

			try {
				await buildForProduction({
					entrypoint: join(tempDir, "app.js"),
					outDir,
					verbose: false,
					platform: "cloudflare",
				});
			} finally {
				process.chdir(originalCwd);
			}

			// Verify files in dist/public/
			expect(await fileExists(join(outDir, "public", "logo.txt"))).toBe(true);
			expect(
				await fileExists(join(outDir, "public", "images", "hero.txt")),
			).toBe(true);

			// Load worker in Miniflare with assets directory
			const workerPath = join(outDir, "server", "worker.js");
			const script = await FS.readFile(workerPath, "utf8");

			mf = await createMiniflare({
				modules: true,
				script,
				compatibilityDate: "2024-09-23",
				compatibilityFlags: ["nodejs_compat"],
				assets: {
					directory: join(outDir, "public"),
					binding: "ASSETS",
					routerConfig: {has_user_worker: true},
				},
			});

			// Fetch the URL map from the worker
			const response = await mf.dispatchFetch("http://localhost/");
			expect(response.status).toBe(200);

			const urlMap = await response.json();
			expect(urlMap["logo.txt"]).toBe("/logo.txt");
			expect(urlMap["images/hero.txt"]).toBe("/images/hero.txt");

			// Verify Miniflare can serve the actual asset files
			const logoResponse = await mf.dispatchFetch("http://localhost/logo.txt");
			expect(logoResponse.status).toBe(200);
			expect(await logoResponse.text()).toBe("I am a logo");

			const heroResponse = await mf.dispatchFetch(
				"http://localhost/images/hero.txt",
			);
			expect(heroResponse.status).toBe(200);
			expect(await heroResponse.text()).toBe("hero image");
		} finally {
			if (mf) {
				await mf.dispose();
			}
			await FS.rm(tempDir, {recursive: true, force: true}).catch(() => {});
		}
	},
	MINIFLARE_TIMEOUT,
);

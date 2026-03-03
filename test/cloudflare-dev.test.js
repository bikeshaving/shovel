import * as FS from "fs/promises";
import {join} from "path";
import {test, expect} from "bun:test";
import {Miniflare} from "miniflare";
import {buildForProduction} from "../src/commands/build.js";
import {copyFixtureToTemp, fileExists} from "./utils.js";

/**
 * Cloudflare dev server E2E tests
 *
 * Tests Miniflare with the assets routing config that createDevServer uses.
 * Verifies that the worker handles requests correctly when assets are
 * configured (matching production Cloudflare behavior).
 */

const TIMEOUT = 60000;

/**
 * Create Miniflare options matching createDevServer's configuration.
 * This mirrors packages/platform-cloudflare/src/platform.ts
 */
function getMiniflareOptions(script, publicDir, port) {
	return {
		modules: true,
		script,
		compatibilityDate: "2024-09-23",
		compatibilityFlags: ["nodejs_compat"],
		port,
		assets: {
			directory: publicDir,
			binding: "ASSETS",
			routerConfig: {has_user_worker: true},
		},
	};
}

test(
	"cloudflare dev - worker handles requests with empty assets directory",
	async () => {
		const fixture = await copyFixtureToTemp("cloudflare-basic");
		let mf;

		try {
			await buildForProduction({
				entrypoint: join(fixture.src, "app.js"),
				outDir: fixture.dist,
				verbose: false,
				platform: "cloudflare",
			});

			const workerPath = join(fixture.dist, "server", "worker.js");
			const publicDir = join(fixture.dist, "public");
			const script = await FS.readFile(workerPath, "utf8");

			// Ensure public dir exists but is empty (no static assets)
			await FS.mkdir(publicDir, {recursive: true});

			mf = new Miniflare(getMiniflareOptions(script, publicDir, 13500));
			await mf.ready;

			// Worker should handle all requests — not 404 from empty assets dir
			const response = await mf.dispatchFetch("http://localhost:13500/");
			expect(response.status).toBe(200);

			const body = await response.text();
			expect(body).toBe("Hello from Cloudflare!");
		} finally {
			if (mf) await mf.dispose();
			await fixture.cleanup();
		}
	},
	TIMEOUT,
);

test(
	"cloudflare dev - worker handles non-asset routes when assets exist",
	async () => {
		const fixture = await copyFixtureToTemp("cloudflare-assets");
		let mf;

		try {
			await buildForProduction({
				entrypoint: join(fixture.src, "app.js"),
				outDir: fixture.dist,
				verbose: false,
				platform: "cloudflare",
			});

			const workerPath = join(fixture.dist, "server", "worker.js");
			const publicDir = join(fixture.dist, "public");
			const script = await FS.readFile(workerPath, "utf8");

			expect(await fileExists(publicDir)).toBe(true);

			mf = new Miniflare(getMiniflareOptions(script, publicDir, 13501));
			await mf.ready;

			// Non-asset route should fall through to worker
			const response = await mf.dispatchFetch("http://localhost:13501/");
			expect(response.status).toBe(200);

			const body = await response.text();
			expect(body).toContain("Test");
		} finally {
			if (mf) await mf.dispose();
			await fixture.cleanup();
		}
	},
	TIMEOUT,
);

test(
	"cloudflare dev - static assets served from public directory",
	async () => {
		const fixture = await copyFixtureToTemp("cloudflare-assets");
		let mf;

		try {
			await buildForProduction({
				entrypoint: join(fixture.src, "app.js"),
				outDir: fixture.dist,
				verbose: false,
				platform: "cloudflare",
			});

			const workerPath = join(fixture.dist, "server", "worker.js");
			const publicDir = join(fixture.dist, "public");
			const script = await FS.readFile(workerPath, "utf8");

			// Find a CSS asset in the public directory
			const assetsDir = join(publicDir, "assets");
			const assetFiles = await FS.readdir(assetsDir);
			const cssFile = assetFiles.find((f) => f.endsWith(".css"));
			expect(cssFile).toBeDefined();

			mf = new Miniflare(getMiniflareOptions(script, publicDir, 13502));
			await mf.ready;

			// Asset should be served directly by Miniflare's asset layer
			const response = await mf.dispatchFetch(
				`http://localhost:13502/assets/${cssFile}`,
			);
			expect(response.status).toBe(200);

			const body = await response.text();
			expect(body).toContain("color");
		} finally {
			if (mf) await mf.dispose();
			await fixture.cleanup();
		}
	},
	TIMEOUT,
);

test(
	"cloudflare dev - without routerConfig worker requests return 404 (regression)",
	async () => {
		const fixture = await copyFixtureToTemp("cloudflare-basic");
		let mf;

		try {
			await buildForProduction({
				entrypoint: join(fixture.src, "app.js"),
				outDir: fixture.dist,
				verbose: false,
				platform: "cloudflare",
			});

			const workerPath = join(fixture.dist, "server", "worker.js");
			const publicDir = join(fixture.dist, "public");
			const script = await FS.readFile(workerPath, "utf8");
			await FS.mkdir(publicDir, {recursive: true});

			// Without routerConfig, Miniflare returns 404 for non-asset requests
			mf = new Miniflare({
				modules: true,
				script,
				compatibilityDate: "2024-09-23",
				compatibilityFlags: ["nodejs_compat"],
				port: 13503,
				assets: {
					directory: publicDir,
					binding: "ASSETS",
					// No routerConfig — this is the bug
				},
			});
			await mf.ready;

			const response = await mf.dispatchFetch("http://localhost:13503/");
			// This confirms the bug exists without the fix
			expect(response.status).toBe(404);
		} finally {
			if (mf) await mf.dispose();
			await fixture.cleanup();
		}
	},
	TIMEOUT,
);

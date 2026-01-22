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
			mf = new Miniflare({
				modules: true,
				script,
				compatibilityDate: "2024-09-23",
				compatibilityFlags: ["nodejs_compat"],
			});

			await mf.ready;

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

import * as FS from "fs/promises";
import {join} from "path";
import {test, expect} from "bun:test";
import {buildForProduction} from "../src/commands/build.js";
import {copyFixtureToTemp, fileExists} from "./utils.js";

/**
 * Cloudflare-specific build tests
 * Copies fixtures to temp directories for test isolation.
 */

const TIMEOUT = 10000;

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
			expect(await fileExists(join(fixture.dist, "server", "server.js"))).toBe(
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
				join(fixture.dist, "server", "server.js"),
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
			expect(await fileExists(join(fixture.dist, "server", "server.js"))).toBe(
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
			expect(await fileExists(join(fixture.dist, "server", "server.js"))).toBe(
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

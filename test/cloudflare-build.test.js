import * as FS from "fs/promises";
import {tmpdir} from "os";
import {join} from "path";
import {test, expect} from "bun:test";
import {buildForProduction} from "../src/commands/build.js";

/**
 * Cloudflare-specific build tests
 * Validates that Cloudflare Workers builds work correctly
 */

const TIMEOUT = 10000; // 10 second timeout for Cloudflare builds

// Helper to create temporary test files
async function createTempFile(filename, content) {
	const tempPath = join(tmpdir(), filename);
	await FS.writeFile(tempPath, content, "utf8");
	return tempPath;
}

// Helper to create temporary directory
async function createTempDir(prefix = "shovel-cf-test-") {
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

test(
	"cloudflare build - basic ServiceWorker",
	async () => {
		const cleanup_paths = [];

		try {
			const entryContent = `
self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Hello from Cloudflare!", {
		headers: { "content-type": "text/plain" }
	}));
});
			`;

			const entryPath = await createTempFile("test-cloudflare.js", entryContent);
			const outDir = await createTempDir();
			cleanup_paths.push(entryPath, outDir);

			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "cloudflare",
			});

			// Verify output files exist
			expect(await fileExists(join(outDir, "server", "server.js"))).toBe(true);
			expect(await fileExists(join(outDir, "server", "package.json"))).toBe(
				true,
			);
			expect(
				await fileExists(join(outDir, "server", "asset-manifest.json")),
			).toBe(true);

			// Verify Cloudflare-specific output
			const serverContent = await FS.readFile(
				join(outDir, "server", "server.js"),
				"utf8",
			);

			// Cloudflare builds should NOT have shebang (browser environment)
			expect(serverContent.startsWith("#!/usr/bin/env")).toBe(false);

			// Should contain the ServiceWorker code
			expect(serverContent).toContain("Hello from Cloudflare!");
			expect(serverContent).toContain("addEventListener");
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

test(
	"cloudflare build - should not hang with esbuild context cleanup",
	async () => {
		const cleanup_paths = [];

		try {
			const entryContent = `
self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Test"));
});
			`;

			const entryPath = await createTempFile(
				"test-cloudflare-timeout.js",
				entryContent,
			);
			const outDir = await createTempDir();
			cleanup_paths.push(entryPath, outDir);

			// This test verifies the build completes without hanging
			// The timeout will fail if the build hangs
			const startTime = Date.now();

			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "cloudflare",
			});

			const buildTime = Date.now() - startTime;

			// Build should complete quickly (less than 5 seconds)
			expect(buildTime).toBeLessThan(5000);

			// Verify output was created
			expect(await fileExists(join(outDir, "server", "server.js"))).toBe(true);
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

test(
	"cloudflare build - with assets",
	async () => {
		const cleanup_paths = [];

		try {
			const entryContent = `
import "./style.css" with { assetBase: "/assets/" };

self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("<html>Test</html>", {
		headers: { "content-type": "text/html" }
	}));
});
			`;

			const styleContent = `body { color: blue; }`;

			const entryPath = await createTempFile(
				"test-cloudflare-assets.js",
				entryContent,
			);
			const stylePath = await createTempFile("style.css", styleContent);
			cleanup_paths.push(entryPath, stylePath);

			const outDir = await createTempDir();
			cleanup_paths.push(outDir);

			await buildForProduction({
				entrypoint: entryPath,
				outDir,
				verbose: false,
				platform: "cloudflare",
			});

			// Verify output structure
			expect(await fileExists(join(outDir, "server", "server.js"))).toBe(true);
			expect(await fileExists(join(outDir, "assets"))).toBe(true);
			expect(
				await fileExists(join(outDir, "server", "asset-manifest.json")),
			).toBe(true);

			// Verify manifest contains the asset
			const manifestContent = await FS.readFile(
				join(outDir, "server", "asset-manifest.json"),
				"utf8",
			);
			const manifest = JSON.parse(manifestContent);
			expect(Object.keys(manifest.assets).length).toBeGreaterThan(0);
		} finally {
			await cleanup(cleanup_paths);
		}
	},
	TIMEOUT,
);

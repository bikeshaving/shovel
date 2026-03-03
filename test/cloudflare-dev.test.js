import * as FS from "fs/promises";
import {join} from "path";
import {describe, test, expect, beforeAll, afterAll} from "bun:test";
import {Miniflare} from "miniflare";
import {buildForProduction} from "../src/commands/build.js";
import {copyFixtureToTemp, fileExists} from "./utils.js";

/**
 * Cloudflare dev server E2E tests
 *
 * Tests Miniflare with the assets routing config that createDevServer uses.
 * Verifies that the worker handles requests correctly when assets are
 * configured (matching production Cloudflare behavior).
 *
 * Each describe block builds once and starts one Miniflare instance,
 * shared across its tests.
 */

const TIMEOUT = 30000;

describe("cloudflare dev - worker only (no static assets)", () => {
	let fixture;
	let mf;
	let baseURL;

	beforeAll(async () => {
		fixture = await copyFixtureToTemp("cloudflare-basic");

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

		mf = new Miniflare({
			modules: true,
			script,
			compatibilityDate: "2024-09-23",
			compatibilityFlags: ["nodejs_compat"],
			port: 0,
			assets: {
				directory: publicDir,
				binding: "ASSETS",
				routerConfig: {has_user_worker: true},
			},
		});
		baseURL = await mf.ready;
	}, TIMEOUT);

	afterAll(async () => {
		if (mf) await mf.dispose();
		if (fixture) await fixture.cleanup();
	});

	test("worker handles requests with empty assets directory", async () => {
		const response = await fetch(new URL("/", baseURL));
		expect(response.status).toBe(200);

		const body = await response.text();
		expect(body).toBe("Hello from Cloudflare!");
	});
});

describe("cloudflare dev - with static assets", () => {
	let fixture;
	let mf;
	let baseURL;

	beforeAll(async () => {
		fixture = await copyFixtureToTemp("cloudflare-assets");

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

		mf = new Miniflare({
			modules: true,
			script,
			compatibilityDate: "2024-09-23",
			compatibilityFlags: ["nodejs_compat"],
			port: 0,
			assets: {
				directory: publicDir,
				binding: "ASSETS",
				routerConfig: {has_user_worker: true},
			},
		});
		baseURL = await mf.ready;
	}, TIMEOUT);

	afterAll(async () => {
		if (mf) await mf.dispose();
		if (fixture) await fixture.cleanup();
	});

	test("non-asset routes fall through to worker", async () => {
		const response = await fetch(new URL("/", baseURL));
		expect(response.status).toBe(200);

		const body = await response.text();
		expect(body).toContain("Test");
	});

	test("static assets served from public directory", async () => {
		const publicDir = join(fixture.dist, "public");
		const assetsDir = join(publicDir, "assets");
		const assetFiles = await FS.readdir(assetsDir);
		const cssFile = assetFiles.find((f) => f.endsWith(".css"));
		expect(cssFile).toBeDefined();

		const response = await fetch(new URL(`/assets/${cssFile}`, baseURL));
		expect(response.status).toBe(200);

		const body = await response.text();
		expect(body).toContain("color");
	});
});

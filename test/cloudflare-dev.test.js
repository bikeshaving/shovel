import * as FS from "fs/promises";
import {join} from "path";
import {test, expect} from "bun:test";
import {Miniflare} from "miniflare";
import {buildForProduction} from "../src/commands/build.js";
import {copyFixtureToTemp} from "./utils.js";

// Only one Miniflare-with-assets instance per file — sequential instances
// hang on GitHub Actions (broken pipe on workerd control fd during dispose).

test("cloudflare dev - worker handles requests with assets routing", async () => {
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
		const baseURL = await mf.ready;

		const response = await fetch(new URL("/", baseURL));
		expect(response.status).toBe(200);

		const body = await response.text();
		expect(body).toBe("Hello from Cloudflare!");
	} finally {
		if (mf) await mf.dispose();
		await fixture.cleanup();
	}
}, 30000);

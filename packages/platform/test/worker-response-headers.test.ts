/**
 * Tests that response headers survive the worker -> main thread boundary
 */

import {describe, it, expect, beforeAll, afterAll} from "bun:test";
import {ServiceWorkerPool} from "../src/index.js";
import {CustomCacheStorage} from "@b9g/cache";
import {MemoryCache} from "@b9g/cache/memory";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {fileURLToPath} from "url";
import * as esbuild from "esbuild";

describe("worker response headers", () => {
	let pool: ServiceWorkerPool;
	let tempDir: string;

	beforeAll(async () => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "worker-headers-test-"));

		// Import the runtime from source so the test covers this checkout
		const currentDir = path.dirname(fileURLToPath(import.meta.url));
		const runtimePath = path.resolve(currentDir, "../src/runtime.ts");

		const workerSourcePath = path.join(tempDir, "headers-worker.ts");
		fs.writeFileSync(
			workerSourcePath,
			`
import {initWorkerRuntime, runLifecycle, startWorkerMessageLoop} from ${JSON.stringify(runtimePath)};

const {registration} = await initWorkerRuntime({config: {}});

self.addEventListener("fetch", (event: FetchEvent) => {
	const url = new URL(event.request.url);
	const headers = new Headers();
	headers.append("set-cookie", "a=1");
	headers.append("set-cookie", "b=2");
	if (url.pathname === "/typed") {
		headers.set("content-type", "application/json");
	}
	event.respondWith(new Response("ok", {headers}));
});

await runLifecycle(registration);
startWorkerMessageLoop(registration);
`,
		);

		const bundledWorkerPath = path.join(tempDir, "headers-worker.js");
		await esbuild.build({
			entryPoints: [workerSourcePath],
			bundle: true,
			format: "esm",
			platform: "node",
			target: "es2022",
			outfile: bundledWorkerPath,
			external: ["node:*"],
		});

		pool = new ServiceWorkerPool(
			{workerCount: 1, requestTimeout: 5000, cwd: tempDir},
			bundledWorkerPath,
			new CustomCacheStorage((name) => new MemoryCache(name)),
		);
		await pool.init();
	});

	afterAll(async () => {
		if (pool) {
			await pool.terminate();
		}
		if (tempDir) {
			fs.rmSync(tempDir, {recursive: true, force: true});
		}
	});

	it("keeps every Set-Cookie header", async () => {
		const response = await pool.handleRequest(
			new Request("http://localhost/test"),
		);
		expect(response.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
	});

	it("keeps an explicit Content-Type", async () => {
		const response = await pool.handleRequest(
			new Request("http://localhost/typed"),
		);
		expect(response.headers.get("content-type")).toBe("application/json");
		expect(response.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
	});
});

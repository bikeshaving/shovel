import * as FS from "fs/promises";
import {join} from "path";
import {test, expect} from "bun:test";
import {Miniflare} from "miniflare";
import {buildForProduction} from "../src/commands/build.js";
import {copyFixtureToTemp} from "./utils.js";

/**
 * Cloudflare WebSocket end-to-end tests.
 *
 * Builds the cloudflare-websocket fixture, runs it through Miniflare with a
 * SHOVEL_WS Durable Object binding, and connects via a real WebSocket
 * client against Miniflare's HTTP port. (Miniflare's dispatchFetch() WS
 * path is known to hang under Bun test; opening a real socket sidesteps
 * that Bun/Miniflare integration bug.)
 *
 * One instance per file — sequential Miniflare+assets starts are known to
 * flake on CI (broken pipe on workerd control fd during dispose).
 */

test(
	"cloudflare websocket - upgrade, subscribe, echo, and close",
	async () => {
		const fixture = await copyFixtureToTemp("cloudflare-websocket");
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
				durableObjects: {
					SHOVEL_WS: "ShovelWebSocketDO",
				},
				assets: {
					directory: publicDir,
					binding: "ASSETS",
					routerConfig: {has_user_worker: true},
				},
			});
			const baseURL = await mf.ready;

			// Confirm HTTP fallback works via real fetch
			const httpRes = await fetch(new URL("/plain", baseURL));
			expect(httpRes.status).toBe(200);
			expect(await httpRes.text()).toBe("HTTP fallback");

			// Connect via real WebSocket client
			const wsURL = new URL("/ws", baseURL);
			wsURL.protocol = wsURL.protocol.replace("http", "ws");
			const ws = new WebSocket(wsURL.href);

			await new Promise((resolve, reject) => {
				ws.addEventListener("open", resolve, {once: true});
				ws.addEventListener("error", reject, {once: true});
				setTimeout(
					() => reject(new Error("WebSocket open timeout")),
					5000,
				);
			});

			// Server should greet us immediately
			const greeting = await new Promise((resolve, reject) => {
				ws.addEventListener("message", (e) => resolve(e.data), {once: true});
				setTimeout(() => reject(new Error("greeting timeout")), 5000);
			});
			expect(greeting).toContain('"type":"welcome"');

			// Echo round-trip
			const echoed = new Promise((resolve, reject) => {
				ws.addEventListener("message", (e) => resolve(e.data), {once: true});
				setTimeout(() => reject(new Error("echo timeout")), 5000);
			});
			ws.send("hi");
			expect(await echoed).toBe("echo: hi");

			// Client-initiated close
			const closed = new Promise((resolve) => {
				ws.addEventListener("close", (e) => resolve(e.code), {once: true});
			});
			ws.close(1000, "test done");
			expect(await closed).toBe(1000);
		} finally {
			if (mf) await mf.dispose();
			await fixture.cleanup();
		}
	},
	30000,
);

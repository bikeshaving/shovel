import * as FS from "fs/promises";
import {join} from "path";
import {test, expect} from "bun:test";
import {Miniflare} from "miniflare";
import {buildForProduction} from "../src/commands/build.js";
import {copyFixtureToTemp} from "./utils.js";

/**
 * Cloudflare PubSub end-to-end tests for cross-isolate fanout.
 *
 * Validates the fetch-based push-on-publish architecture: the pubsub DO
 * holds a per-channel registry of subscriber DO IDs (persisted to
 * `ctx.storage` so eviction doesn't drop it) and dispatches each publish via
 * `env.SHOVEL_WS.get(doId).fetch("/_shovel_publish", ...)`, which Cloudflare
 * uses to wake hibernated subscriber DOs.
 *
 * These tests address the pubsub DO directly via Miniflare's namespace stub
 * rather than going through `BroadcastChannel.postMessage` from a user
 * worker. Miniflare collapses the user-worker and DO module scopes, so
 * `setBroadcastChannelBackend` calls from the WS DO clobber the user-
 * worker's backend in the test environment. In production these are
 * separate isolates and the BC publish path works end-to-end. Calling the
 * pubsub DO directly cleanly simulates a publish from an external isolate
 * (sender = null) and exercises the same wake-fetch leg the architecture
 * depends on.
 */

async function withMiniflare(fn) {
	const fixture = await copyFixtureToTemp("cloudflare-pubsub-hibernation");
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
				SHOVEL_PUBSUB: "ShovelPubSubDO",
			},
			assets: {
				directory: publicDir,
				binding: "ASSETS",
				routerConfig: {has_user_worker: true},
			},
		});
		const baseURL = await mf.ready;
		await fn({mf, baseURL});
	} finally {
		if (mf) await mf.dispose();
		await fixture.cleanup();
	}
}

async function openWS(baseURL) {
	const wsURL = new URL("/ws", baseURL);
	wsURL.protocol = wsURL.protocol.replace("http", "ws");
	const ws = new WebSocket(wsURL.href);
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve, {once: true});
		ws.addEventListener("error", reject, {once: true});
		setTimeout(() => reject(new Error("ws open timeout")), 5000);
	});
	// Drain the "ready" greeting so the test only deals with subsequent frames.
	await new Promise((resolve, reject) => {
		ws.addEventListener("message", resolve, {once: true});
		setTimeout(() => reject(new Error("ready timeout")), 5000);
	});
	return ws;
}

async function nextMessage(ws, timeoutMs = 5000) {
	return new Promise((resolve, reject) => {
		ws.addEventListener("message", (e) => resolve(e.data), {once: true});
		setTimeout(() => reject(new Error("message timeout")), timeoutMs);
	});
}

async function collectMessages(ws, count, timeoutMs = 5000) {
	const out = [];
	const handler = (e) => {
		out.push(e.data);
	};
	ws.addEventListener("message", handler);
	try {
		const deadline = Date.now() + timeoutMs;
		while (out.length < count) {
			if (Date.now() > deadline) {
				throw new Error(
					`expected ${count} messages, got ${out.length}: ${JSON.stringify(out)}`,
				);
			}
			await new Promise((r) => setTimeout(r, 25));
		}
	} finally {
		ws.removeEventListener("message", handler);
	}
	return out;
}

async function publishViaPubSubDO(mf, channel, data) {
	const ns = await mf.getDurableObjectNamespace("SHOVEL_PUBSUB");
	const stub = ns.get(ns.idFromName("pubsub"));
	const res = await stub.fetch("http://internal/publish", {
		method: "POST",
		headers: {"Content-Type": "application/json"},
		body: JSON.stringify({channel, data, sender: null}),
	});
	if (res.status !== 204) {
		throw new Error(`publish status ${res.status}`);
	}
}

test("cross-isolate publish reaches WS subscriber via pubsub DO wake", async () => {
	await withMiniflare(async ({mf, baseURL}) => {
		const ws = await openWS(baseURL);
		try {
			const got = nextMessage(ws);
			await publishViaPubSubDO(
				mf,
				"room:lobby",
				JSON.stringify({type: "msg", text: "hello"}),
			);
			const data = await got;
			expect(data).toContain('"text":"hello"');
		} finally {
			ws.close();
		}
	});
}, 30000);

test("publishes from a single source arrive in publish order", async () => {
	await withMiniflare(async ({mf, baseURL}) => {
		const ws = await openWS(baseURL);
		try {
			const collected = collectMessages(ws, 3, 8000);
			await publishViaPubSubDO(
				mf,
				"room:lobby",
				JSON.stringify({type: "msg", text: "a"}),
			);
			await publishViaPubSubDO(
				mf,
				"room:lobby",
				JSON.stringify({type: "msg", text: "b"}),
			);
			await publishViaPubSubDO(
				mf,
				"room:lobby",
				JSON.stringify({type: "msg", text: "c"}),
			);
			const msgs = await collected;
			expect(msgs.map((s) => JSON.parse(s).text)).toEqual(["a", "b", "c"]);
		} finally {
			ws.close();
		}
	});
}, 30000);

test("WS DO answers 409 for a publish on a channel it has no subscriber on", async () => {
	// 409 is the signal the pubsub DO uses to reap a stale (channel, doId)
	// registry entry left behind by a subscriber DO that went away without a
	// clean unsubscribe. A DO with no live subscriber for the channel must
	// report it so the registry self-heals.
	await withMiniflare(async ({mf}) => {
		const ns = await mf.getDurableObjectNamespace("SHOVEL_WS");
		const stub = ns.get(ns.idFromName("shovel-ws"));
		const res = await stub.fetch("http://internal/_shovel_publish", {
			method: "POST",
			headers: {"Content-Type": "application/json"},
			body: JSON.stringify({channel: "room:nobody", data: "x"}),
		});
		expect(res.status).toBe(409);
	});
}, 30000);

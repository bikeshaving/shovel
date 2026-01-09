/**
 * Worker Execution Model Integration Tests
 *
 * These tests verify that ServiceWorker code always runs in a worker thread
 * (never the main thread) for consistent dev/prod parity.
 *
 * Key invariants:
 * 1. workers=1 prod: main thread spawns single worker with server + ServiceWorker
 * 2. workers=N prod (Bun): each worker owns its server with reusePort
 * 3. workers=N prod (Node): main thread owns server, workers via postMessage
 * 4. SHOVEL_SPAWNED_WORKER env var correctly identifies Shovel-spawned workers
 */

import {describe, test, expect} from "bun:test";

const TIMEOUT = 30000;

describe("Worker Execution Model", () => {
	describe("Entry Template Structure", () => {
		test(
			"Bun entry template uses SHOVEL_SPAWNED_WORKER env var",
			async () => {
				const {BunPlatform} = await import("@b9g/platform-bun");
				const platform = new BunPlatform();

				const wrapper = platform.getEntryWrapper("/app/entry.js", {
					type: "production",
				});

				// Should use explicit marker instead of Bun.isMainThread
				expect(wrapper).toContain("SHOVEL_SPAWNED_WORKER");
				expect(wrapper).toContain('process.env.SHOVEL_SPAWNED_WORKER === "1"');

				// Should use isShovelWorker variable for the conditional, not Bun.isMainThread
				expect(wrapper).toContain(
					"const isShovelWorker = process.env.SHOVEL_SPAWNED_WORKER",
				);
				expect(wrapper).toContain("if (isShovelWorker)");
			},
			TIMEOUT,
		);

		test(
			"Node entry template uses SHOVEL_SPAWNED_WORKER env var",
			async () => {
				const {default: NodePlatform} = await import("@b9g/platform-node");
				const platform = new NodePlatform();

				const wrapper = platform.getEntryWrapper("/app/entry.js", {
					type: "production",
				});

				// Should use explicit marker
				expect(wrapper).toContain("SHOVEL_SPAWNED_WORKER");
				expect(wrapper).toContain('process.env.SHOVEL_SPAWNED_WORKER === "1"');

				// Should use isShovelWorker variable for the conditional
				expect(wrapper).toContain(
					"const isShovelWorker = process.env.SHOVEL_SPAWNED_WORKER",
				);
				expect(wrapper).toContain("if (isShovelWorker)");
			},
			TIMEOUT,
		);

		test(
			"Bun entry template spawns workers for all worker counts",
			async () => {
				const {BunPlatform} = await import("@b9g/platform-bun");
				const platform = new BunPlatform();

				const wrapper = platform.getEntryWrapper("/app/entry.js", {
					type: "production",
				});

				// Should spawn workers regardless of WORKERS count
				// The template should NOT have a condition like "if (WORKERS > 1)"
				// that would skip spawning for workers=1
				expect(wrapper).toContain("for (let i = 0; i < WORKERS; i++)");
				expect(wrapper).toContain("new Worker(import.meta.path");

				// Should set env var when spawning
				expect(wrapper).toContain("SHOVEL_SPAWNED_WORKER:");
			},
			TIMEOUT,
		);

		test(
			"Bun worker thread runs both server and ServiceWorker",
			async () => {
				const {BunPlatform} = await import("@b9g/platform-bun");
				const platform = new BunPlatform();

				const wrapper = platform.getEntryWrapper("/app/entry.js", {
					type: "production",
				});

				// Worker should set up Bun.serve
				expect(wrapper).toContain("Bun.serve({");
				expect(wrapper).toContain("fetch: serviceWorker.handleRequest");

				// Worker should send ready message
				expect(wrapper).toContain('postMessage({type: "ready"');
			},
			TIMEOUT,
		);

		test(
			"Bun entry template includes reusePort only for multi-worker",
			async () => {
				const {BunPlatform} = await import("@b9g/platform-bun");
				const platform = new BunPlatform();

				const wrapper = platform.getEntryWrapper("/app/entry.js", {
					type: "production",
				});

				// reusePort should be conditional on WORKERS > 1
				expect(wrapper).toContain("reusePort: WORKERS > 1");
			},
			TIMEOUT,
		);

		test(
			"Node entry template handles workers=1 differently from workers=N",
			async () => {
				const {default: NodePlatform} = await import("@b9g/platform-node");
				const platform = new NodePlatform();

				const wrapper = platform.getEntryWrapper("/app/entry.js", {
					type: "production",
				});

				// Should have conditional for workers=1 vs workers=N
				expect(wrapper).toContain("if (WORKERS === 1)");

				// workers=1: worker owns server
				expect(wrapper).toContain(
					"platform.createServer(serviceWorker.handleRequest",
				);

				// workers=N: main thread owns server
				expect(wrapper).toContain("Multi-worker mode");
			},
			TIMEOUT,
		);
	});

	describe("Crash Handling", () => {
		test(
			"Bun entry template includes crash handling with backoff",
			async () => {
				const {BunPlatform} = await import("@b9g/platform-bun");
				const platform = new BunPlatform();

				const wrapper = platform.getEntryWrapper("/app/entry.js", {
					type: "production",
				});

				// Should have restart limit
				expect(wrapper).toContain("MAX_RESTARTS");

				// Should have restart window
				expect(wrapper).toContain("RESTART_WINDOW_MS");

				// Should track shutdown state to prevent false restarts
				expect(wrapper).toContain("shuttingDown");

				// Should handle worker close/exit
				expect(wrapper).toMatch(/worker\.addEventListener\(["']close["']/);
			},
			TIMEOUT,
		);

		test(
			"Node entry template includes crash handling with backoff",
			async () => {
				const {default: NodePlatform} = await import("@b9g/platform-node");
				const platform = new NodePlatform();

				const wrapper = platform.getEntryWrapper("/app/entry.js", {
					type: "production",
				});

				// Should have restart limit
				expect(wrapper).toContain("MAX_RESTARTS");

				// Should have restart window
				expect(wrapper).toContain("RESTART_WINDOW_MS");

				// Should track shutdown state
				expect(wrapper).toContain("shuttingDown");

				// Should handle worker exit
				expect(wrapper).toMatch(/worker\.on\(["']exit["']/);
			},
			TIMEOUT,
		);
	});

	describe("Port Availability Check", () => {
		test(
			"Bun entry template checks port availability before spawning",
			async () => {
				const {BunPlatform} = await import("@b9g/platform-bun");
				const platform = new BunPlatform();

				const wrapper = platform.getEntryWrapper("/app/entry.js", {
					type: "production",
				});

				// Should check port availability
				expect(wrapper).toContain("checkPort");
				expect(wrapper).toContain("Port unavailable");

				// Check should happen before spawning workers
				const checkPortIndex = wrapper.indexOf("checkPort");
				const spawnIndex = wrapper.indexOf("new Worker(import.meta.path");
				expect(checkPortIndex).toBeLessThan(spawnIndex);
			},
			TIMEOUT,
		);

		test(
			"Node entry template checks port availability before spawning",
			async () => {
				const {default: NodePlatform} = await import("@b9g/platform-node");
				const platform = new NodePlatform();

				const wrapper = platform.getEntryWrapper("/app/entry.js", {
					type: "production",
				});

				// Should check port availability
				expect(wrapper).toContain("checkPort");
				expect(wrapper).toContain("Port unavailable");
			},
			TIMEOUT,
		);
	});

	describe("Graceful Shutdown", () => {
		test(
			"Bun entry template handles SIGINT and SIGTERM",
			async () => {
				const {BunPlatform} = await import("@b9g/platform-bun");
				const platform = new BunPlatform();

				const wrapper = platform.getEntryWrapper("/app/entry.js", {
					type: "production",
				});

				expect(wrapper).toContain('process.on("SIGINT"');
				expect(wrapper).toContain('process.on("SIGTERM"');
				expect(wrapper).toContain("worker.terminate()");
			},
			TIMEOUT,
		);

		test(
			"Node entry template handles SIGINT and SIGTERM",
			async () => {
				const {default: NodePlatform} = await import("@b9g/platform-node");
				const platform = new NodePlatform();

				const wrapper = platform.getEntryWrapper("/app/entry.js", {
					type: "production",
				});

				expect(wrapper).toContain('process.on("SIGINT"');
				expect(wrapper).toContain('process.on("SIGTERM"');
			},
			TIMEOUT,
		);

		test(
			"Node worker responds to shutdown message",
			async () => {
				const {default: NodePlatform} = await import("@b9g/platform-node");
				const platform = new NodePlatform();

				const wrapper = platform.getEntryWrapper("/app/entry.js", {
					type: "production",
				});

				// Worker should listen for shutdown message
				expect(wrapper).toContain('msg.type === "shutdown"');
				expect(wrapper).toContain('postMessage({type: "shutdown-complete"');
			},
			TIMEOUT,
		);
	});
});

describe("Worker Entry Template", () => {
	test(
		"Bun worker entry template sets up message loop",
		async () => {
			const {BunPlatform} = await import("@b9g/platform-bun");
			const platform = new BunPlatform();

			const wrapper = platform.getEntryWrapper("/app/entry.js", {
				type: "worker",
			});

			// Should import and call startWorkerMessageLoop
			expect(wrapper).toContain("startWorkerMessageLoop");

			// Should import initWorkerRuntime
			expect(wrapper).toContain("initWorkerRuntime");

			// Should configure logging
			expect(wrapper).toContain("configureLogging");
		},
		TIMEOUT,
	);

	test(
		"Node worker entry template sets up message loop",
		async () => {
			const {default: NodePlatform} = await import("@b9g/platform-node");
			const platform = new NodePlatform();

			const wrapper = platform.getEntryWrapper("/app/entry.js", {
				type: "worker",
			});

			// Should import and call startWorkerMessageLoop
			expect(wrapper).toContain("startWorkerMessageLoop");

			// Should import initWorkerRuntime
			expect(wrapper).toContain("initWorkerRuntime");
		},
		TIMEOUT,
	);
});

/* eslint-disable no-restricted-properties -- Tests need process.cwd/env */
/**
 * E2E tests for Bun production runtime
 *
 * Tests WebSocket support (single-worker + multi-worker) and BroadcastChannel
 * through the full build → run → connect pipeline using the Bun platform.
 */

import * as FS from "fs/promises";
import {tmpdir} from "os";
import {join} from "path";
import {test, expect, describe} from "bun:test";
import {buildForProduction} from "../src/commands/build.js";
import {spawn} from "child_process";
import {createConnection} from "net";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["test", "e2e-bun-runtime"]);

const TIMEOUT = 20000;

// ============================================================================
// HELPERS
// ============================================================================

async function createTestProject(files) {
	const projectDir = join(
		tmpdir(),
		`shovel-bun-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await FS.mkdir(projectDir, {recursive: true});

	for (const [filename, content] of Object.entries(files)) {
		const filePath = join(projectDir, filename);
		await FS.mkdir(join(filePath, ".."), {recursive: true});
		await FS.writeFile(filePath, content, "utf8");
	}

	const nodeModulesSource = join(process.cwd(), "node_modules");
	const nodeModulesLink = join(projectDir, "node_modules");
	await FS.symlink(nodeModulesSource, nodeModulesLink, "dir");

	return projectDir;
}

async function cleanup(paths) {
	for (const path of paths) {
		try {
			await FS.rm(path, {recursive: true, force: true});
		} catch (err) {
			logger.debug`Cleanup of ${path} failed: ${err}`;
		}
	}
}

async function buildProject(projectDir) {
	const outDir = join(projectDir, "dist");
	const originalCwd = process.cwd();
	process.chdir(projectDir);
	try {
		await buildForProduction({
			entrypoint: join(projectDir, "app.js"),
			outDir,
			verbose: false,
			platform: "bun",
		});
	} finally {
		process.chdir(originalCwd);
	}
	return outDir;
}

async function isPortOpen(port) {
	return new Promise((resolve) => {
		const socket = createConnection({port, host: "localhost", timeout: 100});
		socket.on("connect", () => {
			socket.destroy();
			resolve(true);
		});
		socket.on("error", () => {
			resolve(false);
		});
		socket.on("timeout", () => {
			socket.destroy();
			resolve(false);
		});
	});
}

async function waitForPort(port, timeoutMs = 10000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await isPortOpen(port)) return true;
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error(`Port ${port} did not open within ${timeoutMs}ms`);
}

async function waitForPortClose(port, timeoutMs = 5000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (!(await isPortOpen(port))) return true;
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error(`Port ${port} did not close within ${timeoutMs}ms`);
}

function startServer(serverDir) {
	const indexPath = join(serverDir, "supervisor.js");
	const child = spawn("bun", ["run", indexPath], {
		cwd: serverDir,
		stdio: ["pipe", "pipe", "pipe"],
		env: {
			...process.env,
			NODE_ENV: "production",
		},
	});

	let stdout = "";
	let stderr = "";

	child.stdout.on("data", (data) => {
		stdout += data.toString();
		logger.debug`[server stdout] ${data.toString().trim()}`;
	});

	child.stderr.on("data", (data) => {
		stderr += data.toString();
		logger.debug`[server stderr] ${data.toString().trim()}`;
	});

	return {
		process: child,
		get stdout() {
			return stdout;
		},
		get stderr() {
			return stderr;
		},
	};
}

async function killServer(child, port) {
	if (child && child.exitCode === null) {
		child.kill("SIGTERM");
		await new Promise((resolve) => {
			const timeout = setTimeout(() => {
				if (child.exitCode === null) child.kill("SIGKILL");
				setTimeout(resolve, 100);
			}, 2000);
			child.on("exit", () => {
				clearTimeout(timeout);
				resolve();
			});
		});
	}
	if (port) {
		await waitForPortClose(port).catch(() => {});
	}
}

// WebSocket echo app used by WS tests
const WS_ECHO_APP = `
self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);
	if (url.pathname === "/ws") {
		const pair = new WebSocketPair();
		const [client, server] = [pair[0], pair[1]];

		server.accept();
		server.addEventListener("message", (ev) => {
			server.send("echo: " + ev.data);
		});

		event.upgradeWebSocket(client);
	} else {
		event.respondWith(new Response("Hello HTTP"));
	}
});
`;

// BroadcastChannel test app — verifies in-process BC messaging works
const BC_TEST_APP = `
self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);
	if (url.pathname === "/bc-test") {
		const promise = new Promise((resolve) => {
			const ch1 = new BroadcastChannel("test-channel");
			const ch2 = new BroadcastChannel("test-channel");

			const results = {received: false, data: null, error: null};

			ch2.onmessage = (ev) => {
				results.received = true;
				results.data = ev.data;
				ch1.close();
				ch2.close();
				resolve(results);
			};

			// Post after a microtask to ensure ch2 listener is registered
			Promise.resolve().then(() => {
				ch1.postMessage({hello: "broadcast"});
			});

			// Timeout fallback
			setTimeout(() => {
				results.error = "timeout";
				ch1.close();
				ch2.close();
				resolve(results);
			}, 2000);
		});

		event.respondWith(
			promise.then((results) =>
				new Response(JSON.stringify(results), {
					headers: {"Content-Type": "application/json"},
				})
			)
		);
	} else {
		event.respondWith(new Response("Hello HTTP"));
	}
});
`;

// ============================================================================
// BUN RUNTIME E2E TESTS
// ============================================================================

describe("runtime: Bun WebSocket single-worker", () => {
	test(
		"WebSocket echo works in single-worker mode",
		async () => {
			const PORT = 13430;
			const cleanup_paths = [];
			let server;

			try {
				const projectDir = await createTestProject({
					"app.js": WS_ECHO_APP,
					"shovel.json": JSON.stringify({
						port: PORT,
						host: "localhost",
						workers: 1,
					}),
				});
				cleanup_paths.push(projectDir);

				const outDir = await buildProject(projectDir);
				server = startServer(join(outDir, "server"));

				await waitForPort(PORT);

				// Connect WebSocket
				const ws = new WebSocket(`ws://localhost:${PORT}/ws`);

				const messages = [];
				const messageReceived = new Promise((resolve) => {
					ws.onmessage = (ev) => {
						messages.push(ev.data);
						resolve();
					};
				});

				await new Promise((resolve) => {
					ws.onopen = () => resolve();
				});

				ws.send("hello");
				await messageReceived;

				expect(messages).toEqual(["echo: hello"]);

				// HTTP still works alongside WebSocket
				const httpRes = await fetch(`http://localhost:${PORT}/`);
				expect(await httpRes.text()).toBe("Hello HTTP");

				ws.close();
			} finally {
				await killServer(server?.process, PORT);
				await cleanup(cleanup_paths);
			}
		},
		TIMEOUT,
	);
});

describe("runtime: Bun WebSocket multi-message", () => {
	test(
		"multiple sequential WebSocket messages work",
		async () => {
			const PORT = 13431;
			const cleanup_paths = [];
			let server;

			try {
				const projectDir = await createTestProject({
					"app.js": WS_ECHO_APP,
					"shovel.json": JSON.stringify({
						port: PORT,
						host: "localhost",
						workers: 1,
					}),
				});
				cleanup_paths.push(projectDir);

				const outDir = await buildProject(projectDir);
				server = startServer(join(outDir, "server"));

				await waitForPort(PORT);

				const ws = new WebSocket(`ws://localhost:${PORT}/ws`);

				const messages = [];
				const allReceived = new Promise((resolve) => {
					ws.onmessage = (ev) => {
						messages.push(ev.data);
						if (messages.length === 3) resolve();
					};
				});

				await new Promise((resolve) => {
					ws.onopen = () => resolve();
				});

				ws.send("first");
				ws.send("second");
				ws.send("third");
				await allReceived;

				expect(messages).toEqual([
					"echo: first",
					"echo: second",
					"echo: third",
				]);

				ws.close();
			} finally {
				await killServer(server?.process, PORT);
				await cleanup(cleanup_paths);
			}
		},
		TIMEOUT,
	);
});

describe("runtime: Bun BroadcastChannel", () => {
	test(
		"BroadcastChannel in-process messaging works",
		async () => {
			const PORT = 13432;
			const cleanup_paths = [];
			let server;

			try {
				const projectDir = await createTestProject({
					"app.js": BC_TEST_APP,
					"shovel.json": JSON.stringify({
						port: PORT,
						host: "localhost",
						workers: 1,
					}),
				});
				cleanup_paths.push(projectDir);

				const outDir = await buildProject(projectDir);
				server = startServer(join(outDir, "server"));

				await waitForPort(PORT);

				// Test BroadcastChannel via HTTP endpoint
				const res = await fetch(`http://localhost:${PORT}/bc-test`);
				expect(res.status).toBe(200);

				const results = await res.json();
				expect(results.received).toBe(true);
				expect(results.data).toEqual({hello: "broadcast"});
				expect(results.error).toBeNull();

				// HTTP still works
				const httpRes = await fetch(`http://localhost:${PORT}/`);
				expect(await httpRes.text()).toBe("Hello HTTP");
			} finally {
				await killServer(server?.process, PORT);
				await cleanup(cleanup_paths);
			}
		},
		TIMEOUT,
	);
});

describe("runtime: Bun WebSocket multi-worker", () => {
	test(
		"WebSocket echo works with reusePort multi-worker",
		async () => {
			const PORT = 13433;
			const cleanup_paths = [];
			let server;

			try {
				const projectDir = await createTestProject({
					"app.js": WS_ECHO_APP,
					"shovel.json": JSON.stringify({
						port: PORT,
						host: "localhost",
						workers: 2,
					}),
				});
				cleanup_paths.push(projectDir);

				const outDir = await buildProject(projectDir);
				server = startServer(join(outDir, "server"));

				await waitForPort(PORT);

				// Connect WebSocket
				const ws = new WebSocket(`ws://localhost:${PORT}/ws`);

				const messages = [];
				const allReceived = new Promise((resolve) => {
					ws.onmessage = (ev) => {
						messages.push(ev.data);
						if (messages.length === 3) resolve();
					};
				});

				await new Promise((resolve) => {
					ws.onopen = () => resolve();
				});

				ws.send("hello");
				ws.send("world");
				ws.send("bun");
				await allReceived;

				expect(messages).toEqual(["echo: hello", "echo: world", "echo: bun"]);

				ws.close();
			} finally {
				await killServer(server?.process, PORT);
				await cleanup(cleanup_paths);
			}
		},
		TIMEOUT,
	);
});

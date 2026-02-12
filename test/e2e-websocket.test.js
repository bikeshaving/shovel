/* eslint-disable no-restricted-properties -- Tests need process.cwd/env */
/**
 * E2E tests for WebSocket support via WebSocketPair
 *
 * Tests both single-worker (direct mode) and multi-worker (message relay)
 * WebSocket upgrade handling through the full build → run → connect pipeline.
 */

import * as FS from "fs/promises";
import {tmpdir} from "os";
import {join} from "path";
import {test, expect, describe} from "bun:test";
import {buildForProduction} from "../src/commands/build.js";
import {spawn} from "child_process";
import {createConnection} from "net";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["test", "e2e-websocket"]);

const TIMEOUT = 20000;

// ============================================================================
// HELPERS (same as e2e-direct-mode.test.js)
// ============================================================================

async function createTestProject(files) {
	const projectDir = join(
		tmpdir(),
		`shovel-ws-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

async function buildProject(projectDir, platform = "node") {
	const outDir = join(projectDir, "dist");
	const originalCwd = process.cwd();
	process.chdir(projectDir);
	try {
		await buildForProduction({
			entrypoint: join(projectDir, "app.js"),
			outDir,
			verbose: false,
			platform,
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
	const child = spawn("node", [indexPath], {
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

// WebSocket echo app used by all tests
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

// ============================================================================
// RUNTIME E2E TESTS (require node in PATH)
// ============================================================================

describe("runtime: WebSocket single-worker (direct mode)", () => {
	test(
		"WebSocket echo works in direct mode",
		async () => {
			const PORT = 13420;
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

				const outDir = await buildProject(projectDir, "node");
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

describe("runtime: WebSocket multi-worker (relay mode)", () => {
	test(
		"WebSocket echo works through worker relay",
		async () => {
			const PORT = 13421;
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

				const outDir = await buildProject(projectDir, "node");
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
				ws.send("relay");
				await allReceived;

				expect(messages).toEqual(["echo: hello", "echo: world", "echo: relay"]);

				ws.close();
			} finally {
				await killServer(server?.process, PORT);
				await cleanup(cleanup_paths);
			}
		},
		TIMEOUT,
	);
});

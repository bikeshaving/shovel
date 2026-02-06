/* eslint-disable no-restricted-properties -- Tests need process.cwd/env */
/**
 * E2E tests for Node.js single-worker direct mode (server-in-worker)
 *
 * Tests the new production behavior where a single-worker Node.js server
 * runs the HTTP server directly in the worker thread, bypassing postMessage.
 *
 * Build output tests validate generated code structure.
 * Runtime tests build, start, and make HTTP requests to verify behavior.
 */

import * as FS from "fs/promises";
import {tmpdir} from "os";
import {join} from "path";
import {test, expect, describe} from "bun:test";
import {buildForProduction} from "../src/commands/build.js";
import {spawn} from "child_process";
import {createConnection} from "net";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["test", "e2e-direct-mode"]);

const TIMEOUT = 20000;

// ============================================================================
// HELPERS
// ============================================================================

async function createTestProject(files) {
	const projectDir = join(
		tmpdir(),
		`shovel-direct-mode-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await FS.mkdir(projectDir, {recursive: true});

	for (const [filename, content] of Object.entries(files)) {
		const filePath = join(projectDir, filename);
		await FS.mkdir(join(filePath, ".."), {recursive: true});
		await FS.writeFile(filePath, content, "utf8");
	}

	// Symlink node_modules from workspace root
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

/** Check if a TCP port is accepting connections */
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

/** Wait for a port to start accepting connections */
async function waitForPort(port, timeoutMs = 10000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await isPortOpen(port)) return true;
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error(`Port ${port} did not open within ${timeoutMs}ms`);
}

/** Wait for a port to stop accepting connections */
async function waitForPortClose(port, timeoutMs = 5000) {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (!(await isPortOpen(port))) return true;
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error(`Port ${port} did not close within ${timeoutMs}ms`);
}

/** Start a production server and return process + helpers */
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

/** Kill a server process gracefully */
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
	// Wait for port to be free
	if (port) {
		await waitForPortClose(port).catch(() => {});
	}
}

/** Fetch with retry for transient failures during server startup */
async function fetchWithRetry(url, retries = 30, delay = 100) {
	for (let i = 0; i < retries; i++) {
		try {
			const response = await fetch(url);
			return response;
		} catch (err) {
			if (i === retries - 1) throw err;
			await new Promise((r) => setTimeout(r, delay));
		}
	}
}

// ============================================================================
// BUILD OUTPUT VALIDATION
// These tests verify the generated code contains the right patterns.
// They don't need node in PATH — they only build and inspect output.
// ============================================================================

describe("build output: Node.js direct mode", () => {
	test(
		"prod worker.js contains dispatchRequest for direct mode path",
		async () => {
			const cleanup_paths = [];
			try {
				const projectDir = await createTestProject({
					"app.js": `
self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("direct mode test"));
});
					`,
					"shovel.json": JSON.stringify({port: 13400, workers: 1}),
				});
				cleanup_paths.push(projectDir);

				const outDir = await buildProject(projectDir, "node");

				const workerContent = await FS.readFile(
					join(outDir, "server", "worker.js"),
					"utf8",
				);

				// Worker should contain dispatchRequest for direct mode path
				expect(workerContent).toContain("dispatchRequest");

				// Worker should contain the "direct mode" log message string
				expect(workerContent).toContain("direct mode");
			} finally {
				await cleanup(cleanup_paths);
			}
		},
		TIMEOUT,
	);

	test(
		"prod worker.js uses usePostMessage option",
		async () => {
			const cleanup_paths = [];
			try {
				const projectDir = await createTestProject({
					"app.js": `
self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("usePostMessage test"));
});
					`,
					"shovel.json": JSON.stringify({port: 13401, workers: 1}),
				});
				cleanup_paths.push(projectDir);

				const outDir = await buildProject(projectDir, "node");

				const workerContent = await FS.readFile(
					join(outDir, "server", "worker.js"),
					"utf8",
				);

				// The usePostMessage property name survives bundling (object property)
				expect(workerContent).toContain("usePostMessage");
			} finally {
				await cleanup(cleanup_paths);
			}
		},
		TIMEOUT,
	);

	test(
		"prod supervisor.js conditionally calls platform.listen() for multi-worker only",
		async () => {
			const cleanup_paths = [];
			try {
				const projectDir = await createTestProject({
					"app.js": `
self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("supervisor test"));
});
					`,
					"shovel.json": JSON.stringify({port: 13402, workers: 1}),
				});
				cleanup_paths.push(projectDir);

				const outDir = await buildProject(projectDir, "node");

				const supervisorContent = await FS.readFile(
					join(outDir, "server", "supervisor.js"),
					"utf8",
				);

				// Supervisor should have the conditional: config.workers > 1
				expect(supervisorContent).toContain("workers > 1");
			} finally {
				await cleanup(cleanup_paths);
			}
		},
		TIMEOUT,
	);

	test(
		"prod worker.js still contains message loop fallback for multi-worker",
		async () => {
			const cleanup_paths = [];
			try {
				const projectDir = await createTestProject({
					"app.js": `
self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("multi-worker test"));
});
					`,
					"shovel.json": JSON.stringify({port: 13403, workers: 4}),
				});
				cleanup_paths.push(projectDir);

				const outDir = await buildProject(projectDir, "node");

				const workerContent = await FS.readFile(
					join(outDir, "server", "worker.js"),
					"utf8",
				);

				// Worker should contain both paths:
				// message loop for multi-worker
				expect(workerContent).toContain("startWorkerMessageLoop");
				// and direct mode for single-worker
				expect(workerContent).toContain("dispatchRequest");
			} finally {
				await cleanup(cleanup_paths);
			}
		},
		TIMEOUT,
	);
});

describe("build output: Bun usePostMessage fix", () => {
	test(
		"Bun prod worker.js passes usePostMessage: false to initWorkerRuntime",
		async () => {
			const cleanup_paths = [];
			try {
				const projectDir = await createTestProject({
					"app.js": `
self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("bun test"));
});
					`,
					"shovel.json": JSON.stringify({port: 13405, workers: 1}),
				});
				cleanup_paths.push(projectDir);

				const outDir = await buildProject(projectDir, "bun");

				const workerContent = await FS.readFile(
					join(outDir, "server", "worker.js"),
					"utf8",
				);

				// Bun prod worker should have usePostMessage property
				expect(workerContent).toContain("usePostMessage");

				// The bundled code should contain the false value for usePostMessage
				expect(workerContent).toMatch(/usePostMessage:\s*false/);
			} finally {
				await cleanup(cleanup_paths);
			}
		},
		TIMEOUT,
	);
});

// ============================================================================
// CODE GENERATION UNIT TESTS
// These test the platform's getEntryPoints() directly (no build needed).
// ============================================================================

describe("code generation: Node.js platform", () => {
	test("prod worker template has direct mode branching", async () => {
		const {getEntryPoints} = await import(
			"@b9g/platform-node/platform"
		);
		const {worker} = getEntryPoints("/fake/entry.js", "production");

		// Should have direct mode variable and branching
		expect(worker).toContain("directMode");
		expect(worker).toContain("dispatchRequest");
		expect(worker).toContain("usePostMessage: !directMode");

		// Should have both code paths
		expect(worker).toContain("createServer");
		expect(worker).toContain("startWorkerMessageLoop");

		// Should have shutdown handler
		expect(worker).toContain("shutdown");
	});

	test("prod supervisor template conditionally calls listen()", async () => {
		const {getEntryPoints} = await import(
			"@b9g/platform-node/platform"
		);
		const {supervisor} = getEntryPoints("/fake/entry.js", "production");

		// Should have conditional listen
		expect(supervisor).toContain("config.workers > 1");
		expect(supervisor).toContain("platform.listen()");
	});

	test("dev worker template uses message loop only", async () => {
		const {getEntryPoints} = await import(
			"@b9g/platform-node/platform"
		);
		const {worker} = getEntryPoints("/fake/entry.js", "development");

		// Should use message loop
		expect(worker).toContain("startWorkerMessageLoop");

		// Should NOT have direct mode code
		expect(worker).not.toContain("dispatchRequest");
		expect(worker).not.toContain("directMode");
		expect(worker).not.toContain("NodePlatform");
	});
});

describe("code generation: Bun platform", () => {
	test("prod worker template has usePostMessage: false", async () => {
		const {getEntryPoints} = await import(
			"@b9g/platform-bun/platform"
		);
		const {worker} = getEntryPoints("/fake/entry.js", "production");

		expect(worker).toContain("usePostMessage: false");
	});
});

// ============================================================================
// RUNTIME E2E TESTS (require node in PATH)
// These build, start the server, and make actual HTTP requests.
// ============================================================================

describe("runtime: Node.js single-worker direct mode", () => {
	test(
		"single-worker production server handles HTTP requests",
		async () => {
			const PORT = 13410;
			const cleanup_paths = [];
			let server;

			try {
				const projectDir = await createTestProject({
					"app.js": `
self.addEventListener("fetch", (event) => {
	const url = new URL(event.request.url);
	if (url.pathname === "/health") {
		event.respondWith(Response.json({status: "ok", mode: "direct"}));
	} else {
		event.respondWith(new Response("Hello from direct mode!"));
	}
});
					`,
					"shovel.json": JSON.stringify({
						port: PORT,
						host: "localhost",
						workers: 1,
					}),
				});
				cleanup_paths.push(projectDir);

				const outDir = await buildProject(projectDir, "node");
				server = startServer(join(outDir, "server"));

				// Wait for server to be ready
				await waitForPort(PORT);

				// Make HTTP request
				const response = await fetchWithRetry(
					`http://localhost:${PORT}/health`,
				);
				expect(response.status).toBe(200);

				const body = await response.json();
				expect(body.status).toBe("ok");
				expect(body.mode).toBe("direct");

				// Also test a plain text response
				const textResponse = await fetch(`http://localhost:${PORT}/`);
				expect(textResponse.status).toBe(200);
				expect(await textResponse.text()).toBe("Hello from direct mode!");
			} finally {
				await killServer(server?.process, PORT);
				await cleanup(cleanup_paths);
			}
		},
		TIMEOUT,
	);

	test(
		"single-worker graceful shutdown closes server",
		async () => {
			const PORT = 13411;
			const cleanup_paths = [];
			let server;

			try {
				const projectDir = await createTestProject({
					"app.js": `
self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("shutdown test"));
});
					`,
					"shovel.json": JSON.stringify({
						port: PORT,
						host: "localhost",
						workers: 1,
					}),
				});
				cleanup_paths.push(projectDir);

				const outDir = await buildProject(projectDir, "node");
				server = startServer(join(outDir, "server"));

				// Wait for server to be ready
				await waitForPort(PORT);

				// Verify server is running
				const response = await fetchWithRetry(`http://localhost:${PORT}/`);
				expect(response.status).toBe(200);

				// Send SIGTERM for graceful shutdown
				server.process.kill("SIGTERM");

				// Wait for process to exit
				const exitCode = await new Promise((resolve) => {
					const timeout = setTimeout(() => resolve(null), 5000);
					server.process.on("exit", (code) => {
						clearTimeout(timeout);
						resolve(code);
					});
				});

				// Process should exit cleanly
				expect(exitCode).toBe(0);

				// Port should be free
				await waitForPortClose(PORT, 2000);
				expect(await isPortOpen(PORT)).toBe(false);

				// Server ref no longer needed for killServer
				server = null;
			} finally {
				await killServer(server?.process, PORT);
				await cleanup(cleanup_paths);
			}
		},
		TIMEOUT,
	);

	test(
		"single-worker handles concurrent requests",
		async () => {
			const PORT = 13412;
			const cleanup_paths = [];
			let server;

			try {
				const projectDir = await createTestProject({
					"app.js": `
let requestCount = 0;
self.addEventListener("fetch", (event) => {
	requestCount++;
	event.respondWith(Response.json({n: requestCount}));
});
					`,
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

				// Fire 20 concurrent requests
				const responses = await Promise.all(
					Array.from({length: 20}, () =>
						fetch(`http://localhost:${PORT}/`).then((r) => r.json()),
					),
				);

				// All requests should succeed and return incrementing counts
				expect(responses.length).toBe(20);
				for (const body of responses) {
					expect(typeof body.n).toBe("number");
					expect(body.n).toBeGreaterThan(0);
				}

				// In single-worker direct mode, all requests go to the same worker
				// so request counts should be sequential (1..20)
				const counts = responses.map((r) => r.n).sort((a, b) => a - b);
				expect(counts[0]).toBe(1);
				expect(counts[counts.length - 1]).toBe(20);
			} finally {
				await killServer(server?.process, PORT);
				await cleanup(cleanup_paths);
			}
		},
		TIMEOUT,
	);

	test(
		"single-worker handles request body (POST)",
		async () => {
			const PORT = 13414;
			const cleanup_paths = [];
			let server;

			try {
				const projectDir = await createTestProject({
					"app.js": `
self.addEventListener("fetch", (event) => {
	event.respondWith((async () => {
		if (event.request.method === "POST") {
			const body = await event.request.text();
			return Response.json({echo: body, method: "POST"});
		}
		return new Response("GET");
	})());
});
					`,
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

				// POST request with body
				const response = await fetch(`http://localhost:${PORT}/`, {
					method: "POST",
					body: "hello world",
				});
				expect(response.status).toBe(200);

				const body = await response.json();
				expect(body.echo).toBe("hello world");
				expect(body.method).toBe("POST");
			} finally {
				await killServer(server?.process, PORT);
				await cleanup(cleanup_paths);
			}
		},
		TIMEOUT,
	);
});

describe("runtime: Node.js multi-worker still works", () => {
	test(
		"multi-worker production server handles HTTP requests via message loop",
		async () => {
			const PORT = 13415;
			const cleanup_paths = [];
			let server;

			try {
				const projectDir = await createTestProject({
					"app.js": `
self.addEventListener("fetch", (event) => {
	event.respondWith(new Response("Hello from multi-worker!"));
});
					`,
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

				const response = await fetchWithRetry(`http://localhost:${PORT}/`);
				expect(response.status).toBe(200);
				expect(await response.text()).toBe("Hello from multi-worker!");
			} finally {
				await killServer(server?.process, PORT);
				await cleanup(cleanup_paths);
			}
		},
		TIMEOUT,
	);
});

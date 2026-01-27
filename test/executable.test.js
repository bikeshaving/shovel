/* eslint-disable no-restricted-properties -- Tests need process.env */
import {test, expect} from "bun:test";
import * as FS from "fs/promises";
import {spawn} from "child_process";
import {join} from "path";
import {copyFixtureToTemp, fileExists} from "./utils.js";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["test", "executable"]);

/**
 * Executable builds integration tests
 *
 * Copies fixtures to temp directories for test isolation.
 * Each fixture has its own package.json with workspace dependencies.
 */

const TIMEOUT = 10000;

// Helper to wait for server to be ready
async function waitForServer(port, host = "localhost", timeoutMs = 3000) {
	const startTime = Date.now();

	while (Date.now() - startTime < timeoutMs) {
		try {
			const response = await fetch(`http://${host}:${port}`);
			if (response.ok || response.status < 500) {
				return await response.text();
			}
		} catch (err) {
			logger.debug`Waiting for server: ${err.message}`;
		}

		await new Promise((resolve) => setTimeout(resolve, 50));
	}

	throw new Error(
		`Server at port ${port} never became ready within ${timeoutMs}ms`,
	);
}

// Helper to run executable and get process
function runExecutable(executablePath, env = {}) {
	const proc = spawn("node", [executablePath], {
		stdio: ["ignore", "pipe", "pipe"],
		env: {...process.env, ...env},
		cwd: join(executablePath, ".."),
	});

	let stderrData = "";
	proc.stderr?.on("data", (data) => {
		stderrData += data.toString();
	});

	proc.stdout?.on("data", () => {});

	proc.on("exit", (code) => {
		if (code !== 0 && stderrData) {
			logger.error`Process exited with code ${code}, stderr: ${stderrData}`;
		}
	});

	return proc;
}

// Helper to kill process and wait
async function killProcess(process) {
	if (process && !process.killed) {
		process.kill("SIGTERM");

		await new Promise((resolve) => {
			process.on("exit", resolve);
			setTimeout(() => {
				if (!process.killed) {
					process.kill("SIGKILL");
				}
				resolve();
			}, 500);
		});
	}

	await new Promise((resolve) => setTimeout(resolve, 100));
}

// ======================
// BASIC BUILD TESTS
// ======================

test(
	"build basic-app fixture",
	async () => {
		const fixture = await copyFixtureToTemp("basic-app");

		try {
			const {buildForProduction} = await import("../src/commands/build.js");

			await buildForProduction({
				entrypoint: join(fixture.src, "app.js"),
				outDir: fixture.dist,
				verbose: false,
				platform: "node",
			});

			// Verify build output (Node platform: supervisor.js + worker.js)
			const supervisorPath = join(fixture.dist, "server", "supervisor.js");
			const workerPath = join(fixture.dist, "server", "worker.js");
			const packagePath = join(fixture.dist, "server", "package.json");

			expect(await fileExists(supervisorPath)).toBe(true);
			expect(await fileExists(workerPath)).toBe(true);
			expect(await fileExists(packagePath)).toBe(true);

			// Verify bundled code contains expected content
			// supervisor.js spawns workers
			const supervisorContent = await FS.readFile(supervisorPath, "utf8");
			expect(supervisorContent).toContain("Worker"); // Uses @b9g/node-webworker

			// worker.js contains the runtime and user code
			const workerContent = await FS.readFile(workerPath, "utf8");
			expect(workerContent).toContain("health");
		} finally {
			await fixture.cleanup();
		}
	},
	TIMEOUT,
);

test(
	"run basic-app executable",
	async () => {
		const fixture = await copyFixtureToTemp("basic-app");
		let serverProcess;

		try {
			const {buildForProduction} = await import("../src/commands/build.js");

			await buildForProduction({
				entrypoint: join(fixture.src, "app.js"),
				outDir: fixture.dist,
				verbose: false,
				platform: "node",
			});

			const supervisorPath = join(fixture.dist, "server", "supervisor.js");
			const PORT = 19001;
			serverProcess = runExecutable(supervisorPath, {PORT: PORT.toString()});

			await waitForServer(PORT);

			// Test health endpoint
			const response = await fetch(`http://localhost:${PORT}/health`);
			expect(response.status).toBe(200);

			const data = await response.json();
			expect(data.status).toBe("ok");
			expect(typeof data.timestamp).toBe("number");
		} finally {
			if (serverProcess) {
				await killProcess(serverProcess);
			}
			await fixture.cleanup();
		}
	},
	TIMEOUT,
);

// ======================
// ENVIRONMENT VARIABLE TESTS
// ======================

test(
	"build and run app-with-env fixture",
	async () => {
		const fixture = await copyFixtureToTemp("app-with-env");
		let serverProcess;

		try {
			const {buildForProduction} = await import("../src/commands/build.js");

			await buildForProduction({
				entrypoint: join(fixture.src, "app.js"),
				outDir: fixture.dist,
				verbose: false,
				platform: "node",
			});

			const supervisorPath = join(fixture.dist, "server", "supervisor.js");
			const PORT = 19002;
			const HOST = "127.0.0.1";
			serverProcess = runExecutable(supervisorPath, {
				PORT: PORT.toString(),
				HOST,
				NODE_ENV: "test",
			});

			await waitForServer(PORT, HOST);

			const response = await fetch(`http://${HOST}:${PORT}/env`);
			const data = await response.json();

			expect(data.port).toBe(PORT.toString());
			expect(data.host).toBe(HOST);
			expect(data.nodeEnv).toBe("test");
		} finally {
			if (serverProcess) {
				await killProcess(serverProcess);
			}
			await fixture.cleanup();
		}
	},
	TIMEOUT,
);

// ======================
// ASSET SERVING TESTS
// ======================

test(
	"build and run app-with-assets fixture",
	async () => {
		const fixture = await copyFixtureToTemp("app-with-assets");
		let serverProcess;

		try {
			const {buildForProduction} = await import("../src/commands/build.js");

			await buildForProduction({
				entrypoint: join(fixture.src, "app.js"),
				outDir: fixture.dist,
				verbose: false,
				platform: "node",
			});

			const supervisorPath = join(fixture.dist, "server", "supervisor.js");
			const PORT = 19003;
			serverProcess = runExecutable(supervisorPath, {PORT: PORT.toString()});

			await waitForServer(PORT);

			// Test main page and extract hashed asset URLs
			const mainResponse = await fetch(`http://localhost:${PORT}/`);
			const mainContent = await mainResponse.text();
			expect(mainContent).toContain("App with Assets");

			// Extract hashed URLs from HTML
			const cssMatch = mainContent.match(/href="(\/assets\/style-[^"]+\.css)"/);
			const jsMatch = mainContent.match(/src="(\/assets\/client-[^"]+\.js)"/);
			expect(cssMatch).not.toBeNull();
			expect(jsMatch).not.toBeNull();

			const cssUrl = cssMatch[1];
			const jsUrl = jsMatch[1];

			// Test CSS asset
			const cssResponse = await fetch(`http://localhost:${PORT}${cssUrl}`);
			expect(cssResponse.status).toBe(200);
			expect(cssResponse.headers.get("content-type")).toBe("text/css");
			const cssContent = await cssResponse.text();
			expect(
				cssContent.includes("background:#f0f0f0") ||
					cssContent.includes("background: #f0f0f0"),
			).toBe(true);

			// Test JS asset
			const jsResponse = await fetch(`http://localhost:${PORT}${jsUrl}`);
			expect(jsResponse.status).toBe(200);
			expect(["text/javascript", "application/javascript"]).toContain(
				jsResponse.headers.get("content-type"),
			);
			const jsContent = await jsResponse.text();
			expect(jsContent).toContain("Asset loaded");
		} finally {
			if (serverProcess) {
				await killProcess(serverProcess);
			}
			await fixture.cleanup();
		}
	},
	TIMEOUT,
);

// ======================
// GRACEFUL SHUTDOWN TEST
// ======================

test(
	"executable graceful shutdown",
	async () => {
		const fixture = await copyFixtureToTemp("basic-app");
		let serverProcess;

		try {
			const {buildForProduction} = await import("../src/commands/build.js");

			await buildForProduction({
				entrypoint: join(fixture.src, "app.js"),
				outDir: fixture.dist,
				verbose: false,
				platform: "node",
			});

			const supervisorPath = join(fixture.dist, "server", "supervisor.js");
			const PORT = 19004;
			serverProcess = runExecutable(supervisorPath, {PORT: PORT.toString()});

			await waitForServer(PORT);

			// Verify server is running
			const response = await fetch(`http://localhost:${PORT}/health`);
			expect(response.status).toBe(200);

			// Send SIGTERM for graceful shutdown
			serverProcess.kill("SIGTERM");

			const exitPromise = new Promise((resolve) => {
				serverProcess.on("exit", (code) => resolve(code));
			});

			const exitCode = await Promise.race([
				exitPromise,
				new Promise((_, reject) =>
					setTimeout(() => reject(new Error("Process didn't exit")), 5000),
				),
			]);

			expect(exitCode).toBe(0);
			serverProcess = null;
		} finally {
			if (serverProcess) {
				await killProcess(serverProcess);
			}
			await fixture.cleanup();
		}
	},
	TIMEOUT,
);

// ======================
// MULTI-WORKER TESTS
// ======================

test("run basic-app with multiple workers", async () => {
	const fixture = await copyFixtureToTemp("basic-app");
	let serverProcess;

	try {
		const {buildForProduction} = await import("../src/commands/build.js");

		await buildForProduction({
			entrypoint: join(fixture.src, "app.js"),
			outDir: fixture.dist,
			verbose: false,
			platform: "node",
		});

		const supervisorPath = join(fixture.dist, "server", "supervisor.js");
		const PORT = 19010;

		// Run with multiple workers - this should NOT cause EADDRINUSE
		serverProcess = runExecutable(supervisorPath, {
			PORT: PORT.toString(),
			WORKERS: "2",
		});

		// Wait for server to be ready
		await waitForServer(PORT);

		// Make multiple requests to verify load balancing works
		const responses = await Promise.all([
			fetch(`http://localhost:${PORT}/health`),
			fetch(`http://localhost:${PORT}/health`),
			fetch(`http://localhost:${PORT}/health`),
			fetch(`http://localhost:${PORT}/health`),
		]);

		// All requests should succeed
		for (const response of responses) {
			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data.status).toBe("ok");
		}
	} finally {
		if (serverProcess) {
			await killProcess(serverProcess);
		}
		await fixture.cleanup();
	}
}, 15000); // Longer timeout for multi-worker startup

test("run basic-app with 4 workers handles concurrent requests", async () => {
	const fixture = await copyFixtureToTemp("basic-app");
	let serverProcess;

	try {
		const {buildForProduction} = await import("../src/commands/build.js");

		await buildForProduction({
			entrypoint: join(fixture.src, "app.js"),
			outDir: fixture.dist,
			verbose: false,
			platform: "node",
		});

		const supervisorPath = join(fixture.dist, "server", "supervisor.js");
		const PORT = 19011;

		// Run with 4 workers
		serverProcess = runExecutable(supervisorPath, {
			PORT: PORT.toString(),
			WORKERS: "4",
		});

		// Wait for server to be ready
		await waitForServer(PORT);

		// Make many concurrent requests
		const requests = Array.from({length: 20}, () =>
			fetch(`http://localhost:${PORT}/health`).then((r) => r.json()),
		);

		const results = await Promise.all(requests);

		// All requests should succeed
		for (const data of results) {
			expect(data.status).toBe("ok");
			expect(typeof data.timestamp).toBe("number");
		}
	} finally {
		if (serverProcess) {
			await killProcess(serverProcess);
		}
		await fixture.cleanup();
	}
}, 20000); // Longer timeout for 4-worker startup

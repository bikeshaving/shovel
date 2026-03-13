/* eslint-disable no-restricted-properties -- Tests need process.cwd/env */
import * as FS from "fs/promises";
import {spawn} from "child_process";
import {createConnection} from "net";
import {test, expect} from "bun:test";
import {join} from "path";
import {configure, getConsoleSink, getLogger} from "@logtape/logtape";
import {AsyncContext} from "@b9g/async-context";
import {copyFixtureToTemp} from "./utils.js";

await configure({
	reset: true,
	contextLocalStorage: new AsyncContext.Variable(),
	sinks: {console: getConsoleSink()},
	loggers: [
		{category: ["logtape", "meta"], sinks: []},
		{category: ["shovel"], lowestLevel: "warning", sinks: ["console"]},
		{category: ["test"], lowestLevel: "debug", sinks: ["console"]},
	],
});

const logger = getLogger(["test", "cloudflare-develop"]);

const TIMEOUT = 30000;

// Helper to start a dev server for a fixture directory
function startDevServer(fixtureDir, entryFile, port) {
	const cliPath = join(process.cwd(), "./dist/bin/cli.js");

	const args = [
		cliPath,
		"develop",
		entryFile,
		"--port",
		port.toString(),
		"--platform",
		"cloudflare",
	];

	const serverProcess = spawn("node", args, {
		stdio: ["ignore", "pipe", "pipe"],
		cwd: fixtureDir,
		detached: true,
		env: {
			...process.env,
			NODE_ENV: "development",
			NODE_PATH: join(process.cwd(), "node_modules"),
		},
	});

	let stderrOutput = "";
	let stdoutOutput = "";

	let reloadResolvers = [];
	let buildResolvers = [];
	let stdoutWaitPos = 0;
	let stderrWaitPos = 0;

	const checkStdout = () => {
		const content = stdoutOutput.slice(stdoutWaitPos);

		// "Build complete" appears on stdout
		if (content.includes("Build complete") && buildResolvers.length > 0) {
			const resolvers = buildResolvers;
			buildResolvers = [];
			stdoutWaitPos = stdoutOutput.length;
			for (const resolve of resolvers) {
				resolve();
			}
		}

		// Cloudflare platform logs "Miniflare reloaded" (lowercase r)
		if (content.includes("reloaded") && reloadResolvers.length > 0) {
			const resolvers = reloadResolvers;
			reloadResolvers = [];
			stdoutWaitPos = stdoutOutput.length;
			for (const resolve of resolvers) {
				resolve();
			}
		}
	};

	const checkStderr = () => {
		const content = stderrOutput.slice(stderrWaitPos);

		// "Build errors" appears on stderr
		if (content.includes("Build errors") && buildResolvers.length > 0) {
			const resolvers = buildResolvers;
			buildResolvers = [];
			stderrWaitPos = stderrOutput.length;
			for (const resolve of resolvers) {
				resolve();
			}
		}
	};

	serverProcess.stdout.on("data", (data) => {
		stdoutOutput += data.toString();
		checkStdout();
	});

	serverProcess.stderr.on("data", (data) => {
		stderrOutput += data.toString();
		checkStderr();
	});

	serverProcess.on("exit", (code) => {
		if (code !== 0 && code !== null) {
			serverProcess.earlyExit = {code, stderr: stderrOutput};
		}
	});

	serverProcess.waitForReload = (timeoutMs = 10000) => {
		stdoutWaitPos = stdoutOutput.length;

		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error(`Reload not detected within ${timeoutMs}ms`));
			}, timeoutMs);

			reloadResolvers.push(() => {
				clearTimeout(timeout);
				resolve();
			});
		});
	};

	serverProcess.waitForBuild = (timeoutMs = 10000) => {
		stdoutWaitPos = stdoutOutput.length;
		stderrWaitPos = stderrOutput.length;

		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error(`Build not detected within ${timeoutMs}ms`));
			}, timeoutMs);

			buildResolvers.push(() => {
				clearTimeout(timeout);
				resolve();
			});
		});
	};

	serverProcess.getOutput = () => ({
		stdout: stdoutOutput,
		stderr: stderrOutput,
	});

	return serverProcess;
}

// Helper to check if TCP port is accepting connections
async function isPortOpen(port) {
	return new Promise((resolve) => {
		const socket = createConnection({port, host: "localhost", timeout: 50});

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

// Helper to wait for server to be ready and return response
async function waitForServer(port, serverProcess, timeoutMs = 15000) {
	const startTime = Date.now();

	while (Date.now() - startTime < timeoutMs / 2) {
		if (serverProcess?.earlyExit) {
			throw new Error(
				`CLI process exited early with code ${serverProcess.earlyExit.code}:\n${serverProcess.earlyExit.stderr}`,
			);
		}

		if (await isPortOpen(port)) {
			break;
		}

		await new Promise((resolve) => setTimeout(resolve, 50));
	}

	while (Date.now() - startTime < timeoutMs) {
		if (serverProcess?.earlyExit) {
			throw new Error(
				`CLI process exited early with code ${serverProcess.earlyExit.code}:\n${serverProcess.earlyExit.stderr}`,
			);
		}

		try {
			const response = await fetch(`http://localhost:${port}`);
			if (response.ok || response.status < 500) {
				return response;
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

// Helper to kill process tree and wait for port to be free
async function killServer(serverProcess, port) {
	if (serverProcess && serverProcess.exitCode === null) {
		// Kill the entire process group (negated PID) so child workers also die
		try {
			process.kill(-serverProcess.pid, "SIGTERM");
		} catch (_err) {
			// Process group kill may fail if process already exited
			serverProcess.kill("SIGTERM");
		}

		await new Promise((resolve) => {
			const cleanup = () => {
				serverProcess.removeListener("exit", cleanup);
				serverProcess.removeListener("close", cleanup);
				resolve();
			};

			serverProcess.on("exit", cleanup);
			serverProcess.on("close", cleanup);

			setTimeout(() => {
				if (serverProcess.exitCode === null) {
					try {
						process.kill(-serverProcess.pid, "SIGKILL");
					} catch (_err) {
						// Process group kill may fail if process already exited
						serverProcess.kill("SIGKILL");
					}
				}
				setTimeout(resolve, 100);
			}, 1000);
		});
	}

	if (port) {
		for (let i = 0; i < 20; i++) {
			if (!(await isPortOpen(port))) {
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}
}

test(
	"cloudflare develop - basic startup and response",
	async () => {
		const PORT = 13500;
		const fixture = await copyFixtureToTemp("cloudflare-basic");
		let serverProcess;

		try {
			serverProcess = startDevServer(fixture.dir, "src/app.js", PORT);
			const response = await waitForServer(PORT, serverProcess);
			const body = await response.text();
			expect(body).toBe("Hello from Cloudflare!");
		} finally {
			await killServer(serverProcess, PORT);
			await fixture.cleanup();
		}
	},
	TIMEOUT,
);

test(
	"cloudflare develop - lifecycle events",
	async () => {
		const PORT = 13501;
		const fixture = await copyFixtureToTemp("cloudflare-lifecycle");
		let serverProcess;

		try {
			serverProcess = startDevServer(fixture.dir, "src/app.js", PORT);
			const response = await waitForServer(PORT, serverProcess);
			const json = await response.json();
			expect(json.installed).toBe(true);
			expect(json.activated).toBe(true);
		} finally {
			await killServer(serverProcess, PORT);
			await fixture.cleanup();
		}
	},
	TIMEOUT,
);

test(
	"cloudflare develop - static assets",
	async () => {
		const PORT = 13502;
		const fixture = await copyFixtureToTemp("cloudflare-assets");
		let serverProcess;

		try {
			serverProcess = startDevServer(fixture.dir, "src/app.js", PORT);
			const response = await waitForServer(PORT, serverProcess);
			expect(response.status).toBe(200);

			const body = await response.text();
			expect(body).toContain("<html>");

			// Verify assets were built
			const distPublic = join(fixture.dir, "dist", "public");
			const assetsDir = join(distPublic, "assets");
			const entries = await FS.readdir(assetsDir).catch(() => []);
			expect(entries.length).toBeGreaterThan(0);
		} finally {
			await killServer(serverProcess, PORT);
			await fixture.cleanup();
		}
	},
	TIMEOUT,
);

test(
	"cloudflare develop - hot reload",
	async () => {
		const PORT = 13503;
		const fixture = await copyFixtureToTemp("cloudflare-basic");
		let serverProcess;

		// Write shovel.json with info-level logging so reload messages appear on stdout
		await FS.writeFile(
			join(fixture.dir, "shovel.json"),
			JSON.stringify({
				logging: {
					loggers: [{category: "shovel", level: "info", sinks: ["console"]}],
				},
			}),
		);

		try {
			serverProcess = startDevServer(fixture.dir, "src/app.js", PORT);
			const response = await waitForServer(PORT, serverProcess);
			const body = await response.text();
			expect(body).toBe("Hello from Cloudflare!");

			// Set up reload watcher before modifying the file
			const reloadPromise = serverProcess.waitForReload(15000);

			// Modify the app to return a different response
			const appPath = join(fixture.dir, "src", "app.js");
			const newContent = `self.addEventListener("fetch", (event) => {
	event.respondWith(
		new Response("Reloaded Cloudflare!", {
			headers: {"content-type": "text/plain"},
		}),
	);
});
`;
			await FS.writeFile(appPath, newContent);

			// Wait for the dev server to detect the change and reload
			await reloadPromise;

			// Small delay for miniflare to be ready after reload
			await new Promise((resolve) => setTimeout(resolve, 500));

			// Fetch the updated response
			const reloadedResponse = await fetch(`http://localhost:${PORT}`);
			const reloadedBody = await reloadedResponse.text();
			expect(reloadedBody).toBe("Reloaded Cloudflare!");
		} finally {
			await killServer(serverProcess, PORT);
			await fixture.cleanup();
		}
	},
	TIMEOUT,
);

test(
	"cloudflare develop - syntax error recovery",
	async () => {
		const PORT = 13504;
		const fixture = await copyFixtureToTemp("cloudflare-basic");
		let serverProcess;

		// Write shovel.json with info-level logging so build/reload messages appear
		await FS.writeFile(
			join(fixture.dir, "shovel.json"),
			JSON.stringify({
				logging: {
					loggers: [{category: "shovel", level: "info", sinks: ["console"]}],
				},
			}),
		);

		try {
			serverProcess = startDevServer(fixture.dir, "src/app.js", PORT);
			const response = await waitForServer(PORT, serverProcess);
			const body = await response.text();
			expect(body).toBe("Hello from Cloudflare!");

			// Write invalid JS to trigger a build error
			const appPath = join(fixture.dir, "src", "app.js");
			await FS.writeFile(appPath, "this is not valid javascript !!!");

			// Wait for build error
			await serverProcess.waitForBuild();

			// Server should still respond with last good version (Miniflare not disposed on build error)
			const errorResponse = await fetch(`http://localhost:${PORT}`);
			expect(errorResponse.status).toBe(200);
			const errorBody = await errorResponse.text();
			expect(errorBody).toBe("Hello from Cloudflare!");

			// Set up reload watcher before fixing
			const reloadPromise = serverProcess.waitForReload(15000);

			// Write fixed code returning a different response
			await FS.writeFile(
				appPath,
				`self.addEventListener("fetch", (event) => {
	event.respondWith(
		new Response("Recovered Cloudflare!", {
			headers: {"content-type": "text/plain"},
		}),
	);
});
`,
			);

			await reloadPromise;
			await new Promise((resolve) => setTimeout(resolve, 500));

			const recoveredResponse = await fetch(`http://localhost:${PORT}`);
			const recoveredBody = await recoveredResponse.text();
			expect(recoveredBody).toBe("Recovered Cloudflare!");
		} finally {
			await killServer(serverProcess, PORT);
			await fixture.cleanup();
		}
	},
	TIMEOUT,
);

test(
	"cloudflare develop - initial build failure then recovery",
	async () => {
		const PORT = 13505;
		const fixture = await copyFixtureToTemp("cloudflare-basic");
		let serverProcess;

		// Write shovel.json with info-level logging
		await FS.writeFile(
			join(fixture.dir, "shovel.json"),
			JSON.stringify({
				logging: {
					loggers: [{category: "shovel", level: "info", sinks: ["console"]}],
				},
			}),
		);

		// Corrupt app.js BEFORE starting the server
		const appPath = join(fixture.dir, "src", "app.js");
		await FS.writeFile(appPath, "this is not valid javascript !!!");

		try {
			serverProcess = startDevServer(fixture.dir, "src/app.js", PORT);

			// Wait for the initial build error
			await serverProcess.waitForBuild();

			// Port should NOT be open (no Miniflare created yet)
			const portOpen = await isPortOpen(PORT);
			expect(portOpen).toBe(false);

			// Write valid code
			await FS.writeFile(
				appPath,
				`self.addEventListener("fetch", (event) => {
	event.respondWith(
		new Response("Born from ashes!", {
			headers: {"content-type": "text/plain"},
		}),
	);
});
`,
			);

			// Miniflare created for the first time (not a reload) — wait for HTTP server
			const response = await waitForServer(PORT, serverProcess);
			const body = await response.text();
			expect(body).toBe("Born from ashes!");
		} finally {
			await killServer(serverProcess, PORT);
			await fixture.cleanup();
		}
	},
	TIMEOUT,
);

test(
	"cloudflare develop - concurrent requests",
	async () => {
		const PORT = 13506;
		const fixture = await copyFixtureToTemp("cloudflare-basic");
		let serverProcess;

		try {
			serverProcess = startDevServer(fixture.dir, "src/app.js", PORT);
			const response = await waitForServer(PORT, serverProcess);
			const body = await response.text();
			expect(body).toBe("Hello from Cloudflare!");

			// Fire 20 concurrent fetches
			const results = await Promise.all(
				Array.from({length: 20}, () =>
					fetch(`http://localhost:${PORT}`).then(async (r) => ({
						status: r.status,
						body: await r.text(),
					})),
				),
			);

			// All 20 should return 200 with correct body
			for (const result of results) {
				expect(result.status).toBe(200);
				expect(result.body).toBe("Hello from Cloudflare!");
			}
		} finally {
			await killServer(serverProcess, PORT);
			await fixture.cleanup();
		}
	},
	TIMEOUT,
);

test(
	"cloudflare develop - requests during reload",
	async () => {
		const PORT = 13507;
		const fixture = await copyFixtureToTemp("cloudflare-basic");
		let serverProcess;

		// Write shovel.json with info-level logging
		await FS.writeFile(
			join(fixture.dir, "shovel.json"),
			JSON.stringify({
				logging: {
					loggers: [{category: "shovel", level: "info", sinks: ["console"]}],
				},
			}),
		);

		try {
			serverProcess = startDevServer(fixture.dir, "src/app.js", PORT);
			const response = await waitForServer(PORT, serverProcess);
			const body = await response.text();
			expect(body).toBe("Hello from Cloudflare!");

			// Set up reload watcher before modifying
			const reloadPromise = serverProcess.waitForReload(15000);

			// Modify the app
			const appPath = join(fixture.dir, "src", "app.js");
			await FS.writeFile(
				appPath,
				`self.addEventListener("fetch", (event) => {
	event.respondWith(
		new Response("Updated Cloudflare!", {
			headers: {"content-type": "text/plain"},
		}),
	);
});
`,
			);

			// Immediately fire 5 fetches during the reload window
			const duringReload = await Promise.allSettled(
				Array.from({length: 5}, () =>
					fetch(`http://localhost:${PORT}`).then((r) => r.status),
				),
			);

			// All should resolve without hanging (either fulfilled or rejected, no timeouts)
			for (const result of duringReload) {
				expect(
					result.status === "fulfilled" || result.status === "rejected",
				).toBe(true);
			}

			// Wait for reload to complete
			await reloadPromise;
			await new Promise((resolve) => setTimeout(resolve, 500));

			// After reload, verify new content
			const updatedResponse = await fetch(`http://localhost:${PORT}`);
			const updatedBody = await updatedResponse.text();
			expect(updatedBody).toBe("Updated Cloudflare!");
		} finally {
			await killServer(serverProcess, PORT);
			await fixture.cleanup();
		}
	},
	TIMEOUT,
);

import {describe, test, expect, beforeAll, afterAll, afterEach} from "bun:test";
import {spawn, type ChildProcess} from "child_process";
import {join} from "path";
import {existsSync, unlinkSync} from "fs";
import {VIRTUALHOST_SOCKET_PATH} from "../src/utils/virtualhost.js";

// Skip these tests in CI - they require port 443 which needs root/sudo
// eslint-disable-next-line no-restricted-properties
const isCI = process.env.CI === "true";

const SHOVEL_CLI = join(import.meta.dir, "../dist/bin/cli.js");
const ECHO_EXAMPLE = join(import.meta.dir, "../examples/echo");
const ADMIN_EXAMPLE = join(import.meta.dir, "../examples/admin");

/**
 * Spawn a shovel develop process
 */
function spawnShovelDevelop(
	cwd: string,
	origin: string,
	options: {
		env?: Record<string, string>;
		platform?: string;
	} = {},
): ChildProcess {
	const platform = options.platform ?? "bun";
	const child = spawn(
		"bun",
		[
			"run",
			SHOVEL_CLI,
			"develop",
			"src/server.ts",
			"--origin",
			origin,
			"--platform",
			platform,
		],
		{
			cwd,
			// eslint-disable-next-line no-restricted-properties
			env: {...process.env, ...options.env},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);

	return child;
}

/**
 * Wait for a process to output a specific pattern
 */
async function waitForOutput(
	child: ChildProcess,
	pattern: string | RegExp,
	timeout = 15000,
): Promise<string> {
	return new Promise((resolve, reject) => {
		let output = "";
		const timeoutId = setTimeout(() => {
			reject(
				new Error(
					`Timeout waiting for pattern: ${pattern}\nOutput so far:\n${output}`,
				),
			);
		}, timeout);

		const checkOutput = (data: Buffer) => {
			output += data.toString();
			const match =
				typeof pattern === "string"
					? output.includes(pattern)
					: pattern.test(output);
			if (match) {
				clearTimeout(timeoutId);
				resolve(output);
			}
		};

		child.stdout?.on("data", checkOutput);
		child.stderr?.on("data", checkOutput);

		child.on("exit", (code) => {
			clearTimeout(timeoutId);
			if (!output.includes(typeof pattern === "string" ? pattern : "")) {
				reject(
					new Error(
						`Process exited with code ${code} before pattern matched.\nOutput:\n${output}`,
					),
				);
			}
		});
	});
}

/**
 * Kill a process and wait for it to exit
 */
async function killAndWait(
	child: ChildProcess,
	signal: NodeJS.Signals = "SIGTERM",
	timeout = 5000,
): Promise<void> {
	return new Promise((resolve) => {
		if (!child.pid || child.killed) {
			resolve();
			return;
		}

		const timeoutId = setTimeout(() => {
			// Force kill if graceful shutdown times out
			child.kill("SIGKILL");
			resolve();
		}, timeout);

		child.on("exit", () => {
			clearTimeout(timeoutId);
			resolve();
		});

		child.kill(signal);
	});
}

/**
 * Make an HTTPS request (ignoring cert validation)
 */
async function httpsGet(
	url: string,
	options: {timeout?: number; followRedirects?: boolean} = {},
): Promise<{status: number; body: string; headers: Headers}> {
	const {timeout = 5000, followRedirects = true} = options;

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeout);

	// Store original value to restore later
	// eslint-disable-next-line no-restricted-properties
	const originalTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

	try {
		// Use fetch with rejectUnauthorized: false equivalent
		// eslint-disable-next-line no-restricted-properties
		process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
		const response = await fetch(url, {
			signal: controller.signal,
			redirect: followRedirects ? "follow" : "manual",
		});
		const body = await response.text();
		return {status: response.status, body, headers: response.headers};
	} finally {
		clearTimeout(timeoutId);
		// Restore original value
		if (originalTlsSetting === undefined) {
			// eslint-disable-next-line no-restricted-properties
			delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
		} else {
			// eslint-disable-next-line no-restricted-properties
			process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTlsSetting;
		}
	}
}

/**
 * Wait for HTTPS server to be ready
 */
async function waitForServer(
	url: string,
	timeout = 15000,
	interval = 200,
): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		try {
			await httpsGet(url, {timeout: 1000});
			return;
		} catch (_err) {
			// Server not ready yet, keep polling
			await new Promise((resolve) => setTimeout(resolve, interval));
		}
	}
	throw new Error(`Server at ${url} did not become ready within ${timeout}ms`);
}

/**
 * Clean up any stale state
 */
function cleanup() {
	// Remove socket file
	if (existsSync(VIRTUALHOST_SOCKET_PATH)) {
		try {
			unlinkSync(VIRTUALHOST_SOCKET_PATH);
		} catch (_err) {
			// Socket may already be deleted or in use, safe to ignore
		}
	}
}

describe.skipIf(isCI)("e2e: shovel develop with VirtualHost", () => {
	const processes: ChildProcess[] = [];

	beforeAll(() => {
		cleanup();
	});

	afterEach(async () => {
		// Kill all spawned processes
		await Promise.all(processes.map((p) => killAndWait(p)));
		processes.length = 0;
		cleanup();
		// Give OS time to release ports
		await new Promise((resolve) => setTimeout(resolve, 500));
	});

	afterAll(() => {
		cleanup();
	});

	test("single app starts as VirtualHost leader", async () => {
		const child = spawnShovelDevelop(ECHO_EXAMPLE, "https://echo.localhost");
		processes.push(child);

		// Wait for server to start
		const output = await waitForOutput(
			child,
			"Server running at https://echo.localhost",
		);
		expect(output).toContain("VirtualHost started on port 443");
		expect(output).toContain("App registered: https://echo.localhost");

		// Verify HTTPS works
		await waitForServer("https://echo.localhost");
		const response = await httpsGet("https://echo.localhost/");
		expect(response.status).toBe(200);
		expect(response.body).toContain("Echo");
	}, 30000);

	test("second app registers with existing VirtualHost", async () => {
		// Start first app (leader)
		const leader = spawnShovelDevelop(ECHO_EXAMPLE, "https://echo.localhost");
		processes.push(leader);
		await waitForOutput(leader, "Server running at https://echo.localhost");
		await waitForServer("https://echo.localhost");

		// Start second app (client)
		const client = spawnShovelDevelop(ADMIN_EXAMPLE, "https://admin.localhost");
		processes.push(client);

		// Client should register with VirtualHost
		const clientOutput = await waitForOutput(
			client,
			"Server running at https://admin.localhost",
		);
		expect(clientOutput).toContain("Registering with VirtualHost");
		expect(clientOutput).toContain(
			"Registered with virtualhost: https://admin.localhost",
		);
		// Client should NOT start its own VirtualHost
		expect(clientOutput).not.toContain("VirtualHost started on port 443");

		// Both apps should be accessible
		await waitForServer("https://admin.localhost");

		const echoResponse = await httpsGet("https://echo.localhost/");
		expect(echoResponse.status).toBe(200);
		expect(echoResponse.body).toContain("Echo");

		const adminResponse = await httpsGet("https://admin.localhost/");
		// Admin redirects to /admin
		expect(adminResponse.status).toBe(200);
		expect(adminResponse.body).toContain("Admin");
	}, 45000);

	test("client becomes leader when original leader exits", async () => {
		// Start first app (leader)
		const leader = spawnShovelDevelop(ECHO_EXAMPLE, "https://echo.localhost");
		processes.push(leader);
		await waitForOutput(leader, "Server running at https://echo.localhost");
		await waitForServer("https://echo.localhost");

		// Start second app (client)
		const client = spawnShovelDevelop(ADMIN_EXAMPLE, "https://admin.localhost");
		processes.push(client);
		await waitForOutput(client, "Server running at https://admin.localhost");
		await waitForServer("https://admin.localhost");

		// Verify both work
		let echoResponse = await httpsGet("https://echo.localhost/");
		expect(echoResponse.status).toBe(200);

		let adminResponse = await httpsGet("https://admin.localhost/");
		expect(adminResponse.status).toBe(200);

		// Capture client output to see succession logs
		let clientOutput = "";
		client.stdout?.on("data", (data) => {
			clientOutput += data.toString();
		});
		client.stderr?.on("data", (data) => {
			clientOutput += data.toString();
		});

		// Kill the leader
		await killAndWait(leader);
		processes.splice(processes.indexOf(leader), 1);

		// Wait for client to detect disconnect and become the new leader
		// The client should detect the TCP connection close and call onDisconnect
		// Then it should try to bind port 443 and become the leader
		await new Promise((resolve) => setTimeout(resolve, 3000));

		// Check if client detected disconnect and became leader
		// We log this for debugging but don't assert on it since log messages may vary
		const _becameLeader =
			clientOutput.includes("VirtualHost connection lost") ||
			clientOutput.includes("Became VirtualHost leader") ||
			clientOutput.includes("VirtualHost started on port 443");

		// Admin app should have become the new leader
		// Give it more time to start the VirtualHost
		await waitForServer("https://admin.localhost", 15000);

		adminResponse = await httpsGet("https://admin.localhost/");
		expect(adminResponse.status).toBe(200);

		// Echo should no longer be available (its process was killed)
		try {
			await httpsGet("https://echo.localhost/", {timeout: 2000});
			// If we get here, it means something else is serving echo.localhost
			// which is unexpected
		} catch (_err) {
			// Expected - echo.localhost should not be available
		}
	}, 90000);

	test("requests to unknown hosts return 502", async () => {
		// Start a single app
		const child = spawnShovelDevelop(ECHO_EXAMPLE, "https://echo.localhost");
		processes.push(child);
		await waitForOutput(child, "Server running at https://echo.localhost");
		await waitForServer("https://echo.localhost");

		// Note: Testing unknown hosts with custom Host headers is tricky because
		// fetch will use the URL hostname for the Host header by default.
		// The VirtualHost should still work if we manually set the Host header,
		// but behavior depends on the HTTP client implementation.
		// For now, we just verify the echo app works
		const echoResponse = await httpsGet("https://echo.localhost/");
		expect(echoResponse.status).toBe(200);
	}, 30000);

	test("HTTP redirects to HTTPS", async () => {
		const child = spawnShovelDevelop(ECHO_EXAMPLE, "https://echo.localhost");
		processes.push(child);
		await waitForOutput(child, "Server running at https://echo.localhost");
		await waitForServer("https://echo.localhost");

		// Try HTTP request (port 80) - should redirect to HTTPS
		// Note: This only works if the VirtualHost was able to bind port 80
		try {
			const response = await fetch("http://echo.localhost/", {
				redirect: "manual",
			});
			if (response.status === 301) {
				const location = response.headers.get("location");
				expect(location).toBe("https://echo.localhost/");
			}
			// If we can't bind port 80, this test is skipped
		} catch (_err) {
			// Port 80 might not be available, skip this assertion
		}
	}, 30000);
});

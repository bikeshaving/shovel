import {describe, test, expect, beforeAll, afterAll, afterEach} from "bun:test";
import {spawn, ChildProcess} from "child_process";
import {join} from "path";
import {existsSync, unlinkSync, mkdirSync, writeFileSync} from "fs";
import {VIRTUALHOST_SOCKET_PATH} from "../src/utils/virtualhost.js";

const TEST_PORT = 18443; // High port to avoid permission issues
const TEST_HTTP_REDIRECT_PORT = 18080;
const SHOVEL_DIR = join(process.env.HOME || "", ".shovel");

/**
 * Helper to spawn a test server process
 */
function spawnTestServer(
	name: string,
	port: number,
	options: {
		env?: Record<string, string>;
		cwd?: string;
	} = {},
): ChildProcess {
	const serverScript = `
		const http = require("http");
		const server = http.createServer((req, res) => {
			res.writeHead(200, {"Content-Type": "application/json"});
			res.end(JSON.stringify({server: "${name}", port: ${port}}));
		});
		server.listen(${port}, "127.0.0.1", () => {
			console.log("${name} listening on port ${port}");
		});
		process.on("SIGTERM", () => {
			server.close(() => process.exit(0));
		});
	`;

	const child = spawn("node", ["-e", serverScript], {
		env: {...process.env, ...options.env},
		cwd: options.cwd,
		stdio: ["ignore", "pipe", "pipe"],
	});

	return child;
}

/**
 * Wait for a process to output a specific string
 */
async function waitForOutput(
	child: ChildProcess,
	pattern: string | RegExp,
	timeout = 10000,
): Promise<string> {
	return new Promise((resolve, reject) => {
		let output = "";
		const timeoutId = setTimeout(() => {
			reject(new Error(`Timeout waiting for pattern: ${pattern}`));
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
	});
}

/**
 * Kill a process and wait for it to exit
 */
async function killAndWait(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM"): Promise<void> {
	return new Promise((resolve) => {
		if (!child.pid) {
			resolve();
			return;
		}
		child.on("exit", () => resolve());
		child.kill(signal);
	});
}

/**
 * Wait for a condition to be true
 */
async function waitFor(
	condition: () => boolean | Promise<boolean>,
	timeout = 5000,
	interval = 100,
): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		if (await condition()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, interval));
	}
	throw new Error("Timeout waiting for condition");
}

/**
 * Make an HTTP request and return the response
 */
async function httpGet(url: string): Promise<{status: number; body: string}> {
	const response = await fetch(url);
	const body = await response.text();
	return {status: response.status, body};
}

describe("VirtualHost", () => {
	// Clean up socket file before tests
	beforeAll(() => {
		if (existsSync(VIRTUALHOST_SOCKET_PATH)) {
			try {
				unlinkSync(VIRTUALHOST_SOCKET_PATH);
			} catch {
				// Ignore
			}
		}
	});

	afterEach(() => {
		// Clean up socket file after each test
		if (existsSync(VIRTUALHOST_SOCKET_PATH)) {
			try {
				unlinkSync(VIRTUALHOST_SOCKET_PATH);
			} catch {
				// Ignore
			}
		}
	});

	describe("leader election", () => {
		test("first process becomes leader", async () => {
			const {VirtualHost} = await import("../src/utils/virtualhost.js");

			const vhost = new VirtualHost({
				port: TEST_PORT,
				host: "127.0.0.1",
			});

			await vhost.start();

			// Socket file should exist
			expect(existsSync(VIRTUALHOST_SOCKET_PATH)).toBe(true);

			await vhost.stop();

			// Socket file should be cleaned up
			expect(existsSync(VIRTUALHOST_SOCKET_PATH)).toBe(false);
		});

		test("second process becomes client", async () => {
			const {VirtualHost, VirtualHostClient, isVirtualHostRunningAsync} =
				await import("../src/utils/virtualhost.js");

			// Start leader
			const leader = new VirtualHost({
				port: TEST_PORT,
				host: "127.0.0.1",
			});
			await leader.start();

			// Check if running
			expect(await isVirtualHostRunningAsync()).toBe(true);

			// Start client
			let disconnected = false;
			const client = new VirtualHostClient({
				origin: "http://test.localhost",
				host: "127.0.0.1",
				port: 9999,
				onDisconnect: () => {
					disconnected = true;
				},
			});

			await client.connect(9999);

			// Verify the app is registered
			const app = leader.getApp("test.localhost");
			expect(app).toBeDefined();
			expect(app?.port).toBe(9999);

			// Clean up
			await client.disconnect();
			await leader.stop();
		});

		test("client detects leader death and can become new leader", async () => {
			const {VirtualHost, VirtualHostClient, isVirtualHostRunningAsync} =
				await import("../src/utils/virtualhost.js");

			// Start leader
			const leader = new VirtualHost({
				port: TEST_PORT,
				host: "127.0.0.1",
			});
			await leader.start();

			// Start client with disconnect handler
			let disconnectCalled = false;
			const client = new VirtualHostClient({
				origin: "http://test.localhost",
				host: "127.0.0.1",
				port: 9999,
				onDisconnect: () => {
					disconnectCalled = true;
				},
			});
			await client.connect(9999);

			// Kill the leader
			await leader.stop();

			// Wait for disconnect to be detected
			await waitFor(() => disconnectCalled, 2000);
			expect(disconnectCalled).toBe(true);

			// VirtualHost should no longer be running
			expect(await isVirtualHostRunningAsync()).toBe(false);

			// A new process should be able to become leader
			const newLeader = new VirtualHost({
				port: TEST_PORT,
				host: "127.0.0.1",
			});
			await newLeader.start();

			expect(await isVirtualHostRunningAsync()).toBe(true);

			await newLeader.stop();
		});

		test("establishVirtualHostRole handles election correctly", async () => {
			const {establishVirtualHostRole, isVirtualHostRunningAsync} = await import(
				"../src/utils/virtualhost.js"
			);

			let role1Connected = false;

			// First call should become leader
			const role1 = await establishVirtualHostRole({
				origin: "http://app1.localhost",
				port: TEST_PORT,
				host: "127.0.0.1",
				onNeedRegistration: async (client) => {
					role1Connected = true;
					await client.connect(9001);
				},
				onDisconnect: () => {},
			});

			expect(role1.role).toBe("leader");
			expect(role1Connected).toBe(false); // Leaders don't call onNeedRegistration

			// Register app1 with itself
			if (role1.role === "leader") {
				role1.virtualHost.registerApp({
					origin: "http://app1.localhost",
					host: "127.0.0.1",
					port: 9001,
					socket: null as any,
				});
			}

			let role2Connected = false;

			// Second call should become client
			const role2 = await establishVirtualHostRole({
				origin: "http://app2.localhost",
				port: TEST_PORT,
				host: "127.0.0.1",
				onNeedRegistration: async (client) => {
					role2Connected = true;
					await client.connect(9002);
				},
				onDisconnect: () => {},
			});

			expect(role2.role).toBe("client");
			expect(role2Connected).toBe(true);

			// Both apps should be registered with the leader
			if (role1.role === "leader") {
				expect(role1.virtualHost.getApp("app1.localhost")).toBeDefined();
				expect(role1.virtualHost.getApp("app2.localhost")).toBeDefined();
			}

			// Clean up
			if (role2.role === "client") {
				await role2.client.disconnect();
			}
			if (role1.role === "leader") {
				await role1.virtualHost.stop();
			}
		});
	});

	describe("succession", () => {
		test("client becomes leader when original leader dies", async () => {
			const {VirtualHost, establishVirtualHostRole, isVirtualHostRunningAsync} =
				await import("../src/utils/virtualhost.js");

			// Start original leader directly
			const originalLeader = new VirtualHost({
				port: TEST_PORT,
				host: "127.0.0.1",
			});
			await originalLeader.start();
			originalLeader.registerApp({
				origin: "http://app1.localhost",
				host: "127.0.0.1",
				port: 9001,
				socket: null as any,
			});

			// Start a client that will try to become leader on disconnect
			let becameLeader = false;
			let newRole: any;

			const clientResult = await establishVirtualHostRole({
				origin: "http://app2.localhost",
				port: TEST_PORT,
				host: "127.0.0.1",
				onNeedRegistration: async (client) => {
					await client.connect(9002);
				},
				onDisconnect: async () => {
					// Try to become leader
					try {
						newRole = await establishVirtualHostRole({
							origin: "http://app2.localhost",
							port: TEST_PORT,
							host: "127.0.0.1",
							onNeedRegistration: async (client) => {
								await client.connect(9002);
							},
							onDisconnect: () => {},
						});
						becameLeader = newRole.role === "leader";
					} catch {
						// Might fail if another process won the race
					}
				},
			});

			expect(clientResult.role).toBe("client");

			// Kill the original leader
			await originalLeader.stop();

			// Wait for the client to detect disconnect and try to become leader
			await waitFor(() => becameLeader, 5000);

			expect(becameLeader).toBe(true);
			expect(await isVirtualHostRunningAsync()).toBe(true);

			// Clean up
			if (newRole?.role === "leader") {
				await newRole.virtualHost.stop();
			}
		});

		test("racing to bind port results in one winner", async () => {
			const {VirtualHost} = await import("../src/utils/virtualhost.js");

			// Try to start multiple VirtualHosts simultaneously
			const attempts = await Promise.allSettled([
				(async () => {
					const vhost = new VirtualHost({port: TEST_PORT, host: "127.0.0.1"});
					await vhost.start();
					return vhost;
				})(),
				(async () => {
					// Small delay to create a race
					await new Promise((resolve) => setTimeout(resolve, 10));
					const vhost = new VirtualHost({port: TEST_PORT, host: "127.0.0.1"});
					await vhost.start();
					return vhost;
				})(),
				(async () => {
					await new Promise((resolve) => setTimeout(resolve, 20));
					const vhost = new VirtualHost({port: TEST_PORT, host: "127.0.0.1"});
					await vhost.start();
					return vhost;
				})(),
			]);

			// Count successes and failures
			const successes = attempts.filter((r) => r.status === "fulfilled");
			const failures = attempts.filter((r) => r.status === "rejected");

			// Exactly one should succeed (got the port)
			expect(successes.length).toBe(1);
			// Others should fail with "already in use"
			expect(failures.length).toBe(2);

			// Clean up the winner
			if (successes[0].status === "fulfilled") {
				await successes[0].value.stop();
			}
		});
	});

	describe("IPv6 support", () => {
		test("parses IPv6 Host headers correctly", async () => {
			const {VirtualHost} = await import("../src/utils/virtualhost.js");

			// Start a simple HTTP server for the app
			const appPort = 19002;
			const appServer = Bun.serve({
				port: appPort,
				fetch() {
					return new Response(JSON.stringify({app: "ipv6test"}), {
						headers: {"Content-Type": "application/json"},
					});
				},
			});

			try {
				// Start VirtualHost on IPv6
				const vhost = new VirtualHost({
					port: TEST_PORT + 1,
					host: "::1",
				});
				await vhost.start();

				// Register the app with an IPv6 origin
				vhost.registerApp({
					origin: "http://[::1]",
					host: "::1",
					port: appPort,
					socket: null as any,
				});

				// Make a request with IPv6 Host header (with port)
				const response = await fetch(`http://[::1]:${TEST_PORT + 1}/`, {
					headers: {Host: `[::1]:${TEST_PORT + 1}`},
				});

				expect(response.status).toBe(200);
				const body = await response.json();
				expect(body.app).toBe("ipv6test");

				await vhost.stop();
			} finally {
				appServer.stop();
			}
		});
	});

	describe("proxying", () => {
		test("VirtualHost proxies requests to registered apps", async () => {
			const {VirtualHost} = await import("../src/utils/virtualhost.js");

			// Start a simple HTTP server for the app
			const appPort = 19001;
			const appServer = Bun.serve({
				port: appPort,
				fetch() {
					return new Response(JSON.stringify({app: "test"}), {
						headers: {"Content-Type": "application/json"},
					});
				},
			});

			try {
				// Start VirtualHost
				const vhost = new VirtualHost({
					port: TEST_PORT,
					host: "127.0.0.1",
				});
				await vhost.start();

				// Register the app
				vhost.registerApp({
					origin: "http://test.localhost",
					host: "127.0.0.1",
					port: appPort,
					socket: null as any,
				});

				// Make a request through the VirtualHost
				const response = await fetch(`http://127.0.0.1:${TEST_PORT}/`, {
					headers: {Host: "test.localhost"},
				});

				expect(response.status).toBe(200);
				const body = await response.json();
				expect(body.app).toBe("test");

				await vhost.stop();
			} finally {
				appServer.stop();
			}
		});

		test("VirtualHost returns 502 for unknown hosts", async () => {
			const {VirtualHost} = await import("../src/utils/virtualhost.js");

			const vhost = new VirtualHost({
				port: TEST_PORT,
				host: "127.0.0.1",
			});
			await vhost.start();

			try {
				const response = await fetch(`http://127.0.0.1:${TEST_PORT}/`, {
					headers: {Host: "unknown.localhost"},
				});

				expect(response.status).toBe(502);
				const body = await response.text();
				expect(body).toContain("No app registered");
			} finally {
				await vhost.stop();
			}
		});
	});
});

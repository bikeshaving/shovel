import {describe, test, expect, beforeEach, afterEach} from "bun:test";
import {existsSync, unlinkSync} from "fs";
import {
	VirtualHost,
	VirtualHostClient,
	isVirtualHostRunningAsync,
	establishVirtualHostRole,
	VIRTUALHOST_SOCKET_PATH,
} from "../src/utils/virtualhost.js";

const TEST_PORT = 18443; // High port to avoid permission issues

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
 * Clean up socket file - called before and after each test
 */
async function cleanupSocket(): Promise<void> {
	// First try to detect if there's a running VirtualHost and let it clean up
	const isRunning = await isVirtualHostRunningAsync();
	if (!isRunning && existsSync(VIRTUALHOST_SOCKET_PATH)) {
		// Socket file exists but no VirtualHost is running - it's stale
		try {
			unlinkSync(VIRTUALHOST_SOCKET_PATH);
		} catch (_err) {
			// Already deleted or in use, safe to ignore
		}
	}
}

describe("VirtualHost", () => {
	beforeEach(async () => {
		await cleanupSocket();
	});

	afterEach(async () => {
		await cleanupSocket();
	});

	describe("leader election", () => {
		test("first process becomes leader", async () => {
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
			// Start leader
			const leader = new VirtualHost({
				port: TEST_PORT,
				host: "127.0.0.1",
			});
			await leader.start();

			// Check if running
			expect(await isVirtualHostRunningAsync()).toBe(true);

			// Start client
			const client = new VirtualHostClient({
				origin: "http://test.localhost",
				host: "127.0.0.1",
				port: 9999,
				onDisconnect: () => {
					// Callback required by interface
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
			let newRole: Awaited<ReturnType<typeof establishVirtualHostRole>> | null =
				null;

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
					} catch (_err) {
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

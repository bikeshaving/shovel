import {test, expect} from "bun:test";

/**
 * ShovelServiceWorkerContainer registry tests
 * Tests the new registry-based architecture for managing multiple ServiceWorkerRegistrations
 */

const TIMEOUT = 1000;

test(
	"ShovelServiceWorkerContainer registry - basic functionality",
	async () => {
		const {ShovelServiceWorkerContainer} = await import("../src/runtime.js");

		const container = new ShovelServiceWorkerContainer();

		// Should have default root registration
		const rootReg = await container.getRegistration("/");
		expect(rootReg).toBeDefined();
		expect(rootReg.scope).toBe("/");

		// Should list scopes
		const scopes = container.getScopes();
		expect(scopes).toContain("/");
	},
	TIMEOUT,
);

test(
	"ShovelServiceWorkerContainer registry - multiple registrations",
	async () => {
		const {ShovelServiceWorkerContainer} = await import("../src/runtime.js");

		const container = new ShovelServiceWorkerContainer();

		// Register multiple ServiceWorkers with different scopes
		const apiReg = await container.register("/api-worker.js", {scope: "/api/"});
		const adminReg = await container.register("/admin-worker.js", {
			scope: "/admin/",
		});

		expect(apiReg.scope).toBe("/api/");
		expect(adminReg.scope).toBe("/admin/");

		// Should be able to retrieve by scope
		const retrievedApi = await container.getRegistration("/api/");
		const retrievedAdmin = await container.getRegistration("/admin/");

		expect(retrievedApi).toBe(apiReg);
		expect(retrievedAdmin).toBe(adminReg);

		// Should list all scopes
		const scopes = container.getScopes();
		expect(scopes).toContain("/");
		expect(scopes).toContain("/api/");
		expect(scopes).toContain("/admin/");
	},
	TIMEOUT,
);

test(
	"ShovelServiceWorkerContainer registry - scope matching",
	async () => {
		const {ShovelServiceWorkerContainer, dispatchRequest} =
			await import("../src/runtime.js");

		const container = new ShovelServiceWorkerContainer();

		// Register ServiceWorkers with different scopes
		const apiReg = await container.register("/api-worker.js", {scope: "/api/"});
		const adminReg = await container.register("/admin-worker.js", {
			scope: "/admin/",
		});

		// Install and activate all registrations
		await container.installAll();

		// Test dispatching to registrations - should correctly reject when no fetch listeners
		const apiRequest = new Request("http://localhost/api/users");
		const adminRequest = new Request("http://localhost/admin/dashboard");
		const rootReg = await container.getRegistration("/");

		// Should reject with "No response provided for fetch event" since no listeners are registered
		await expect(dispatchRequest(apiReg, apiRequest)).rejects.toThrow(
			"No response provided for fetch event",
		);
		await expect(dispatchRequest(adminReg, adminRequest)).rejects.toThrow(
			"No response provided for fetch event",
		);
		const rootRequest = new Request("http://localhost/");
		await expect(dispatchRequest(rootReg, rootRequest)).rejects.toThrow(
			"No response provided for fetch event",
		);
	},
	TIMEOUT,
);

test(
	"ShovelServiceWorkerContainer registry - scope normalization",
	async () => {
		const {ShovelServiceWorkerContainer} = await import("../src/runtime.js");

		const container = new ShovelServiceWorkerContainer();

		// Register with various scope formats
		const reg1 = await container.register("/worker.js", {scope: "api"}); // Should normalize to /api/
		const reg2 = await container.register("/worker.js", {scope: "/admin"}); // Should normalize to /admin/
		const reg3 = await container.register("/worker.js", {scope: "/public/"}); // Should stay /public/

		expect(reg1.scope).toBe("/api/");
		expect(reg2.scope).toBe("/admin/");
		expect(reg3.scope).toBe("/public/");

		// Should be retrievable with normalized scopes
		expect(await container.getRegistration("/api/")).toBe(reg1);
		expect(await container.getRegistration("/admin/")).toBe(reg2);
		expect(await container.getRegistration("/public/")).toBe(reg3);
	},
	TIMEOUT,
);

test(
	"ShovelServiceWorkerContainer registry - unregister functionality",
	async () => {
		const {ShovelServiceWorkerContainer} = await import("../src/runtime.js");

		const container = new ShovelServiceWorkerContainer();

		// Register a ServiceWorker
		await container.register("/worker.js", {scope: "/temp/"});

		// Should exist
		expect(await container.getRegistration("/temp/")).toBeDefined();
		expect(container.getScopes()).toContain("/temp/");

		// Unregister it
		const success = await container.unregister("/temp/");
		expect(success).toBe(true);

		// Should no longer exist
		expect(await container.getRegistration("/temp/")).toBeUndefined();
		expect(container.getScopes()).not.toContain("/temp/");

		// Unregistering non-existent scope should return false
		const failureResult = await container.unregister("/nonexistent/");
		expect(failureResult).toBe(false);
	},
	TIMEOUT,
);

test(
	"ShovelServiceWorkerContainer registry - get all registrations",
	async () => {
		const {ShovelServiceWorkerContainer} = await import("../src/runtime.js");

		const container = new ShovelServiceWorkerContainer();

		// Initially should have just the root registration
		let allRegs = await container.getRegistrations();
		expect(allRegs.length).toBe(1);
		expect(allRegs[0].scope).toBe("/");

		// Register additional ServiceWorkers
		await container.register("/api-worker.js", {scope: "/api/"});
		await container.register("/admin-worker.js", {scope: "/admin/"});

		// Should now have 3 registrations
		allRegs = await container.getRegistrations();
		expect(allRegs.length).toBe(3);

		const scopes = allRegs.map((reg) => reg.scope).sort();
		expect(scopes).toEqual(["/", "/admin/", "/api/"]);
	},
	TIMEOUT,
);

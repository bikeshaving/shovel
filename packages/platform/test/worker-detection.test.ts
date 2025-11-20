import {test, expect, describe} from "bun:test";
import {WorkerGlobalScope, DedicatedWorkerGlobalScope, ShovelGlobalScope} from "../src/runtime.js";

describe("Worker Detection", () => {
	test("WorkerGlobalScope class is defined", () => {
		expect(WorkerGlobalScope).toBeDefined();
		expect(typeof WorkerGlobalScope).toBe("function");
	});

	test("DedicatedWorkerGlobalScope extends WorkerGlobalScope", () => {
		expect(DedicatedWorkerGlobalScope).toBeDefined();
		expect(DedicatedWorkerGlobalScope.prototype).toBeInstanceOf(WorkerGlobalScope);
	});

	test("ShovelGlobalScope extends DedicatedWorkerGlobalScope", () => {
		expect(ShovelGlobalScope).toBeDefined();
		// Note: We can't use instanceof here because ShovelGlobalScope doesn't extend DedicatedWorkerGlobalScope directly
		// It implements ServiceWorkerGlobalScope interface instead
	});

	test("WorkerGlobalScope not on globalThis in main thread", () => {
		// Clean up any previous test pollution
		delete (globalThis as any).WorkerGlobalScope;
		delete (globalThis as any).DedicatedWorkerGlobalScope;

		// In main thread, WorkerGlobalScope should not be on globalThis
		expect((globalThis as any).WorkerGlobalScope).toBeUndefined();
		expect((globalThis as any).DedicatedWorkerGlobalScope).toBeUndefined();
	});

	test("ShovelGlobalScope.install() adds WorkerGlobalScope to globalThis", async () => {
		// Create a mock caches object
		const mockCaches = {
			open: async () => ({
				match: async () => undefined,
				put: async () => {},
				delete: async () => false,
				keys: async () => [],
			}),
			match: async () => undefined,
			has: async () => false,
			delete: async () => false,
			keys: async () => [],
		};

		// Create a minimal ShovelGlobalScope instance
		const scope = new ShovelGlobalScope({
			caches: mockCaches as any,
			isDevelopment: false,
		});

		// Install the scope
		scope.install();

		// After install, WorkerGlobalScope should be available on globalThis
		expect((globalThis as any).WorkerGlobalScope).toBeDefined();
		expect((globalThis as any).DedicatedWorkerGlobalScope).toBeDefined();
		expect((globalThis as any).WorkerGlobalScope).toBe(WorkerGlobalScope);
		expect((globalThis as any).DedicatedWorkerGlobalScope).toBe(DedicatedWorkerGlobalScope);

		// Clean up
		delete (globalThis as any).WorkerGlobalScope;
		delete (globalThis as any).DedicatedWorkerGlobalScope;
	});

	test("Worker detection using typeof WorkerGlobalScope", () => {
		// Main thread: WorkerGlobalScope not on globalThis
		expect(typeof (globalThis as any).WorkerGlobalScope).toBe("undefined");

		// Simulate worker context
		(globalThis as any).WorkerGlobalScope = WorkerGlobalScope;
		expect(typeof (globalThis as any).WorkerGlobalScope).not.toBe("undefined");

		// Clean up
		delete (globalThis as any).WorkerGlobalScope;
	});
});

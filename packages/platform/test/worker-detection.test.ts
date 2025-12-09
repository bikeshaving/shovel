import {test, expect, describe} from "bun:test";
import {
	WorkerGlobalScope,
	DedicatedWorkerGlobalScope,
	ServiceWorkerGlobals,
	ShovelServiceWorkerRegistration,
	CustomLoggerStorage,
} from "../src/runtime.js";
import {CustomDirectoryStorage} from "@b9g/filesystem";

describe("Worker Detection", () => {
	test("WorkerGlobalScope class is defined", () => {
		expect(WorkerGlobalScope).toBeDefined();
		expect(typeof WorkerGlobalScope).toBe("function");
	});

	test("DedicatedWorkerGlobalScope extends WorkerGlobalScope", () => {
		expect(DedicatedWorkerGlobalScope).toBeDefined();
		expect(DedicatedWorkerGlobalScope.prototype).toBeInstanceOf(
			WorkerGlobalScope,
		);
	});

	test("ServiceWorkerGlobals is defined", () => {
		expect(ServiceWorkerGlobals).toBeDefined();
		// Note: ServiceWorkerGlobals implements ServiceWorkerGlobalScope interface
		// It doesn't extend DedicatedWorkerGlobalScope directly
	});

	test("WorkerGlobalScope not on globalThis in main thread", () => {
		// Clean up any previous test pollution
		delete (globalThis as any).WorkerGlobalScope;
		delete (globalThis as any).DedicatedWorkerGlobalScope;

		// In main thread, WorkerGlobalScope should not be on globalThis
		expect((globalThis as any).WorkerGlobalScope).toBeUndefined();
		expect((globalThis as any).DedicatedWorkerGlobalScope).toBeUndefined();
	});

	test("ServiceWorkerGlobals.install() adds WorkerGlobalScope to globalThis", async () => {
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

		// Create mock loggers
		const mockLogger = {
			category: [] as string[],
			parent: null,
			getChild: function () {
				return this;
			},
			with: function () {
				return this;
			},
			debug: () => {},
			info: () => {},
			warn: () => {},
			error: () => {},
			fatal: () => {},
			trace: () => {},
		};
		const mockLoggers = new CustomLoggerStorage(() => mockLogger as any);

		// Create mock directories
		const mockDirectories = new CustomDirectoryStorage(async () => {
			throw new Error("Not implemented");
		});

		// Create a minimal ServiceWorkerGlobals instance
		const scope = new ServiceWorkerGlobals({
			registration: new ShovelServiceWorkerRegistration(),
			caches: mockCaches as any,
			directories: mockDirectories,
			loggers: mockLoggers,
			isDevelopment: false,
		});

		// Install the scope
		scope.install();

		// After install, WorkerGlobalScope should be available on globalThis
		expect((globalThis as any).WorkerGlobalScope).toBeDefined();
		expect((globalThis as any).DedicatedWorkerGlobalScope).toBeDefined();
		expect((globalThis as any).WorkerGlobalScope).toBe(WorkerGlobalScope);
		expect((globalThis as any).DedicatedWorkerGlobalScope).toBe(
			DedicatedWorkerGlobalScope,
		);

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

import {test, expect, describe, beforeEach, afterEach} from "bun:test";
import {Worker} from "../src/index.js";
import {tmpdir} from "os";
import {join} from "path";
import {writeFileSync, unlinkSync, mkdtempSync} from "fs";

describe("Node Web Worker", () => {
	let tempDir: string;
	let workerScript: string;

	beforeEach(() => {
		// Create a temporary directory for test scripts
		tempDir = mkdtempSync(join(tmpdir(), "worker-test-"));
	});

	afterEach(() => {
		// Clean up any worker script
		if (workerScript) {
			try {
				unlinkSync(workerScript);
			} catch {
				// File might not exist
			}
		}
	});

	test("should create worker and handle basic message passing", async () => {
		// Create a simple worker script
		workerScript = join(tempDir, "test-worker.js");
		writeFileSync(
			workerScript,
			`
			// Simple echo worker
			addEventListener("message", (event) => {
				postMessage({ echo: event.data });
			});
		`,
		);

		const worker = new Worker(workerScript);
		
		return new Promise((resolve) => {
			worker.addEventListener("message", (event) => {
				expect(event.type).toBe("message");
				expect(event.data.echo).toBe("Hello, Worker!");
				
				worker.terminate().then(() => {
					resolve(true);
				});
			});
			
			worker.postMessage("Hello, Worker!");
		});
	});

	test("should handle worker errors", async () => {
		// Create a worker script that throws an error
		workerScript = join(tempDir, "error-worker.js");
		writeFileSync(
			workerScript,
			`
			// Worker that throws an error
			throw new Error("Test worker error");
		`,
		);

		const worker = new Worker(workerScript);
		
		return new Promise((resolve) => {
			worker.addEventListener("error", (event) => {
				expect(event.type).toBe("error");
				expect(event.error).toBeInstanceOf(Error);
				
				worker.terminate().then(() => {
					resolve(true);
				});
			});
		});
	});

	test("should support multiple message listeners", async () => {
		workerScript = join(tempDir, "multi-listener-worker.js");
		writeFileSync(
			workerScript,
			`
			addEventListener("message", (event) => {
				postMessage("response");
			});
		`,
		);

		const worker = new Worker(workerScript);
		let listener1Called = false;
		let listener2Called = false;
		
		return new Promise((resolve) => {
			const listener1 = () => {
				listener1Called = true;
				checkCompletion();
			};
			
			const listener2 = () => {
				listener2Called = true;
				checkCompletion();
			};
			
			const checkCompletion = () => {
				if (listener1Called && listener2Called) {
					worker.terminate().then(() => {
						resolve(true);
					});
				}
			};
			
			worker.addEventListener("message", listener1);
			worker.addEventListener("message", listener2);
			
			worker.postMessage("trigger");
		});
	});

	test("should remove event listeners", async () => {
		workerScript = join(tempDir, "remove-listener-worker.js");
		writeFileSync(
			workerScript,
			`
			addEventListener("message", (event) => {
				postMessage("response");
			});
		`,
		);

		const worker = new Worker(workerScript);
		let callCount = 0;
		
		return new Promise((resolve) => {
			const listener = () => {
				callCount++;
				
				if (callCount === 1) {
					// Remove the listener after first call
					worker.removeEventListener("message", listener);
					
					// Send another message - should not trigger listener
					worker.postMessage("second");
					
					// Wait a bit and check that listener wasn't called again
					setTimeout(() => {
						expect(callCount).toBe(1);
						worker.terminate().then(() => {
							resolve(true);
						});
					}, 100);
				}
			};
			
			worker.addEventListener("message", listener);
			worker.postMessage("first");
		});
	});

	test("should expose underlying Node.js worker", () => {
		workerScript = join(tempDir, "simple-worker.js");
		writeFileSync(workerScript, "// Simple worker");
		
		const worker = new Worker(workerScript);
		
		expect(worker.nodeWorker_).toBeDefined();
		expect(typeof worker.nodeWorker_.postMessage).toBe("function");
		
		return worker.terminate();
	});

	test("should handle transferable objects warning", async () => {
		workerScript = join(tempDir, "transfer-worker.js");
		writeFileSync(
			workerScript,
			`
			addEventListener("message", (event) => {
				postMessage("received");
			});
		`,
		);

		const worker = new Worker(workerScript);
		
		// Mock console.warn to capture the warning
		const originalWarn = console.warn;
		let warningCalled = false;
		console.warn = (message: string) => {
			if (message.includes("Transferable objects not fully supported")) {
				warningCalled = true;
			}
		};
		
		return new Promise((resolve) => {
			worker.addEventListener("message", () => {
				console.warn = originalWarn;
				expect(warningCalled).toBe(true);
				
				worker.terminate().then(() => {
					resolve(true);
				});
			});
			
			// Create a mock transferable object
			const buffer = new ArrayBuffer(8);
			worker.postMessage("test", [buffer as any]);
		});
	});

	test("should warn about unsupported event types", () => {
		workerScript = join(tempDir, "unsupported-worker.js");
		writeFileSync(workerScript, "// Worker for unsupported event test");
		
		const worker = new Worker(workerScript);
		
		// Mock console.warn
		const originalWarn = console.warn;
		let warningMessage = "";
		console.warn = (message: string) => {
			warningMessage = message;
		};
		
		// Try to add listener for unsupported event
		worker.addEventListener("unsupported" as any, () => {});
		
		console.warn = originalWarn;
		expect(warningMessage).toContain("Unsupported event type: unsupported");
		
		return worker.terminate();
	});
});
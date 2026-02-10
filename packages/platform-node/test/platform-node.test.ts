import {test, expect, describe, beforeEach, afterEach, mock} from "bun:test";
import {NodePlatform} from "../src/index.js";
import {tmpdir} from "os";
import {join} from "path";
import {mkdtempSync, rmSync} from "fs";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["test", "platform-node"]);

describe("NodePlatform", () => {
	let platform: NodePlatform;
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "node-platform-test-"));
		platform = new NodePlatform({
			cwd: tempDir,
		});
	});

	afterEach(async () => {
		await platform.dispose();
		try {
			rmSync(tempDir, {recursive: true, force: true});
		} catch (err) {
			logger.debug`Cleanup of ${tempDir} failed: ${err}`;
		}
	});

	test("should have correct name", () => {
		expect(platform.name).toBe("node");
	});

	test("should create platform with default options", () => {
		const defaultPlatform = new NodePlatform();
		expect(defaultPlatform.name).toBe("node");
		expect(defaultPlatform).toBeDefined();
	});

	test("should create HTTP server", async () => {
		const mockHandler = mock(() => Promise.resolve({response: new Response("OK")}));
		const server = platform.createServer(mockHandler, {
			port: 8080,
			host: "127.0.0.1",
		});

		expect(server).toBeDefined();
		expect(server.address().port).toBe(8080);
		expect(server.address().host).toBe("127.0.0.1");
		expect(server.url).toBe("http://127.0.0.1:8080");
		expect(server.ready).toBe(false); // Not listening yet
	});

	test("should handle server listen and close", async () => {
		const handler = mock(() => Promise.resolve({response: new Response("OK")}));
		const server = platform.createServer(handler, {
			port: 0, // Use random port
		});

		// Test listen
		await server.listen();
		expect(server.ready).toBe(true);

		// Test close
		await server.close();
		expect(server.ready).toBe(false);
	});

	test("should reload workers via serviceWorker container", async () => {
		// Create a mock for the reloadWorkers method
		const mockReload = mock(() => Promise.resolve());

		// Mock the serviceWorker.reloadWorkers method directly
		(platform.serviceWorker as any).reloadWorkers = mockReload;

		await platform.reloadWorkers("new-entrypoint.js");
		expect(mockReload).toHaveBeenCalledWith("new-entrypoint.js");
	});

	test("should dispose resources via serviceWorker container", async () => {
		// Create a mock for the terminate method
		const mockTerminate = mock(() => Promise.resolve());

		// Mock the serviceWorker.terminate method directly
		(platform.serviceWorker as any).terminate = mockTerminate;

		await platform.dispose();
		expect(mockTerminate).toHaveBeenCalled();
	});

	test("should convert Node.js request to Web API Request", async () => {
		const handler = mock((req: Request) => {
			expect(req).toBeInstanceOf(Request);
			expect(req.url).toContain("http://");
			return Promise.resolve({response: new Response("OK")});
		});

		const server = platform.createServer(handler, {port: 0, host: "127.0.0.1"});
		await server.listen();

		// Make a request to the server
		const port = server.address().port;
		const response = await fetch(`http://127.0.0.1:${port}/test`);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("OK");

		await server.close();
	});

	test("should handle POST requests with body", async () => {
		const handler = mock(async (req: Request) => {
			const body = await req.text();
			expect(body).toBe("test data");
			expect(req.method).toBe("POST");
			return {response: new Response("Received")};
		});

		const server = platform.createServer(handler, {port: 0, host: "127.0.0.1"});
		await server.listen();

		const port = server.address().port;
		const response = await fetch(`http://127.0.0.1:${port}/test`, {
			method: "POST",
			body: "test data",
		});
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("Received");

		await server.close();
	});

	test("should handle request errors gracefully", async () => {
		const handler = mock((): never => {
			throw new Error("Handler error");
		});

		const server = platform.createServer(handler, {port: 0, host: "127.0.0.1"});
		await server.listen();

		const port = server.address().port;
		const response = await fetch(`http://127.0.0.1:${port}/test`);
		expect(response.status).toBe(500);
		expect(await response.text()).toBe("Internal Server Error");

		await server.close();
	});

	test("should stream response body", async () => {
		const handler = mock(() => {
			const stream = new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode("chunk1"));
					controller.enqueue(new TextEncoder().encode("chunk2"));
					controller.close();
				},
			});
			return Promise.resolve({response: new Response(stream)});
		});

		const server = platform.createServer(handler, {port: 0, host: "127.0.0.1"});
		await server.listen();

		const port = server.address().port;
		const response = await fetch(`http://127.0.0.1:${port}/test`);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("chunk1chunk2");

		await server.close();
	});

	test("should use custom port and host", () => {
		const customPlatform = new NodePlatform({
			port: 9090,
			host: "0.0.0.0",
		});

		expect((customPlatform as any).options.port).toBe(9090);
		expect((customPlatform as any).options.host).toBe("0.0.0.0");
	});

	test("should use custom cwd", () => {
		const customCwd = "/custom/path";
		const customPlatform = new NodePlatform({
			cwd: customCwd,
		});

		expect((customPlatform as any).options.cwd).toBe(customCwd);
	});
});

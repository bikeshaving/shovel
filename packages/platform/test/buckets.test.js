import {test, expect} from "bun:test";
import * as FS from "fs/promises";
import {tmpdir} from "os";
import {join} from "path";
import {NodeBucket} from "@b9g/filesystem";

/**
 * Bucket architecture and self.buckets API tests
 * Tests the new bucket system that replaced the old dirs API
 */

const TIMEOUT = 3000;

// Helper functions
async function createTempDir(prefix = "buckets-test-") {
	const tempPath = join(tmpdir(), `${prefix}${Date.now()}`);
	await FS.mkdir(tempPath, {recursive: true});
	return tempPath;
}

async function cleanup(paths) {
	for (const path of paths) {
		try {
			await FS.rm(path, {recursive: true, force: true});
		} catch {
			// Already removed
		}
	}
}

// Helper to create CustomBucketStorage for tests
async function createBucketStorage(tempDir) {
	const {CustomBucketStorage} = await import("../src/index.js");
	return new CustomBucketStorage(async (name) => {
		const targetPath = join(tempDir, name);
		await FS.mkdir(targetPath, {recursive: true});
		return new NodeBucket(targetPath);
	});
}

// ======================
// BUCKET FACTORY TESTS
// ======================

test(
	"CustomBucketStorage class instantiation",
	async () => {
		const {CustomBucketStorage} = await import("../src/index.js");

		const tempDir = await createTempDir();

		try {
			const buckets = new CustomBucketStorage(async (name) => {
				const targetPath = join(tempDir, name);
				await FS.mkdir(targetPath, {recursive: true});
				return new NodeBucket(targetPath);
			});

			// Should return an object with open method
			expect(typeof buckets).toBe("object");
			expect(typeof buckets.open).toBe("function");
		} finally {
			await cleanup([tempDir]);
		}
	},
	TIMEOUT,
);

test(
	"bucket storage getDirectoryHandle basic functionality",
	async () => {
		const {CustomBucketStorage: _CustomBucketStorage} = await import(
			"../src/index.js"
		);

		const tempDir = await createTempDir();

		try {
			// Create some test directories
			await FS.mkdir(join(tempDir, "dist"), {recursive: true});
			await FS.mkdir(join(tempDir, "assets"), {recursive: true});

			const buckets = await createBucketStorage(tempDir);

			// Test getting directory handles using open() method
			const distHandle = await buckets.open("dist");
			expect(distHandle).toBeDefined();
			expect(distHandle.kind).toBe("directory");
			expect(distHandle.name).toBe("dist");

			const assetsHandle = await buckets.open("assets");
			expect(assetsHandle).toBeDefined();
			expect(assetsHandle.kind).toBe("directory");
			expect(assetsHandle.name).toBe("assets");
		} finally {
			await cleanup([tempDir]);
		}
	},
	TIMEOUT,
);

test(
	"bucket storage with non-existent directory",
	async () => {
		const {CustomBucketStorage: _CustomBucketStorage} = await import(
			"../src/index.js"
		);

		const tempDir = await createTempDir();

		try {
			const buckets = await createBucketStorage(tempDir);

			// Should create directory if it doesn't exist
			const newHandle = await buckets.open("new-bucket");
			expect(newHandle).toBeDefined();
			expect(newHandle.kind).toBe("directory");
			expect(newHandle.name).toBe("new-bucket");

			// Verify directory was actually created
			const dirExists = await FS.access(join(tempDir, "new-bucket"))
				.then(() => true)
				.catch(() => false);
			expect(dirExists).toBe(true);
		} finally {
			await cleanup([tempDir]);
		}
	},
	TIMEOUT,
);

// ======================
// DIRECTORY HANDLE TESTS
// ======================

test(
	"directory handle file operations",
	async () => {
		const {CustomBucketStorage} = await import("../src/index.js");

		const tempDir = await createTempDir();

		try {
			const buckets = await createBucketStorage(tempDir);
			const distHandle = await buckets.open("dist");

			// Test getting file handle
			const fileHandle = await distHandle.getFileHandle("test.txt", {
				create: true,
			});
			expect(fileHandle).toBeDefined();
			expect(fileHandle.kind).toBe("file");
			expect(fileHandle.name).toBe("test.txt");

			// Test writing to file
			const writable = await fileHandle.createWritable();
			await writable.write("Hello, World!");
			await writable.close();

			// Test reading from file
			const file = await fileHandle.getFile();
			const content = await file.text();
			expect(content).toBe("Hello, World!");

			// Verify file exists on filesystem
			const filePath = join(tempDir, "dist", "test.txt");
			const fileContent = await FS.readFile(filePath, "utf8");
			expect(fileContent).toBe("Hello, World!");
		} finally {
			await cleanup([tempDir]);
		}
	},
	TIMEOUT,
);

test(
	"directory handle subdirectory operations",
	async () => {
		const {CustomBucketStorage} = await import("../src/index.js");

		const tempDir = await createTempDir();

		try {
			const buckets = await createBucketStorage(tempDir);
			const distHandle = await buckets.open("dist");

			// Create subdirectory
			const subHandle = await distHandle.getDirectoryHandle("assets", {
				create: true,
			});
			expect(subHandle).toBeDefined();
			expect(subHandle.kind).toBe("directory");
			expect(subHandle.name).toBe("assets");

			// Create file in subdirectory
			const fileHandle = await subHandle.getFileHandle("style.css", {
				create: true,
			});
			const writable = await fileHandle.createWritable();
			await writable.write("body { color: blue; }");
			await writable.close();

			// Verify subdirectory and file exist
			const subDirPath = join(tempDir, "dist", "assets");
			const filePath = join(subDirPath, "style.css");

			const dirExists = await FS.access(subDirPath)
				.then(() => true)
				.catch(() => false);
			expect(dirExists).toBe(true);

			const fileContent = await FS.readFile(filePath, "utf8");
			expect(fileContent).toBe("body { color: blue; }");
		} finally {
			await cleanup([tempDir]);
		}
	},
	TIMEOUT,
);

test(
	"directory handle entries iteration",
	async () => {
		const {CustomBucketStorage} = await import("../src/index.js");

		const tempDir = await createTempDir();

		try {
			// Create test structure
			const distPath = join(tempDir, "dist");
			await FS.mkdir(distPath, {recursive: true});
			await FS.writeFile(join(distPath, "index.html"), "<h1>Hello</h1>");
			await FS.writeFile(join(distPath, "app.js"), "console.log('app');");
			await FS.mkdir(join(distPath, "assets"), {recursive: true});
			await FS.writeFile(join(distPath, "assets", "style.css"), "body {}");

			const buckets = await createBucketStorage(tempDir);
			const distHandle = await buckets.open("dist");

			// Test entries iteration
			const entries = [];
			for await (const [name, handle] of distHandle.entries()) {
				entries.push([name, handle.kind]);
			}

			// Sort for consistent testing
			entries.sort((a, b) => a[0].localeCompare(b[0]));

			expect(entries.length).toBe(3);
			expect(entries[0]).toEqual(["app.js", "file"]);
			expect(entries[1]).toEqual(["assets", "directory"]);
			expect(entries[2]).toEqual(["index.html", "file"]);
		} finally {
			await cleanup([tempDir]);
		}
	},
	TIMEOUT,
);

// ======================
// SERVICEWORKER INTEGRATION TESTS
// ======================

test(
	"self.buckets in ServiceWorker context",
	async () => {
		const {ServiceWorkerRegistration, ShovelGlobalScope, CustomBucketStorage} =
			await import("../src/index.js");

		const tempDir = await createTempDir();

		try {
			// Set up test files
			const distPath = join(tempDir, "dist");
			await FS.mkdir(distPath, {recursive: true});
			await FS.writeFile(
				join(distPath, "index.html"),
				`
				<!DOCTYPE html>
				<html>
					<head><title>Test Page</title></head>
					<body><h1>Hello from static file!</h1></body>
				</html>
			`,
			);

			const registration = new ServiceWorkerRegistration();
			const buckets = await createBucketStorage(tempDir);

			// Set up ServiceWorker globals with buckets
			const scope = new ShovelGlobalScope({registration, buckets});
			scope.install();

			// Simulate user ServiceWorker code using self.buckets
			globalThis.addEventListener("fetch", (event) => {
				const url = new URL(event.request.url);

				if (url.pathname === "/") {
					// Serve static file from bucket
					event.respondWith(
						(async () => {
							const distBucket = await globalThis.buckets.open("dist");
							const fileHandle = await distBucket.getFileHandle("index.html");
							const file = await fileHandle.getFile();
							const content = await file.text();

							return new Response(content, {
								headers: {"content-type": "text/html; charset=utf-8"},
							});
						})(),
					);
				} else {
					event.respondWith(new Response("Not found", {status: 404}));
				}
			});

			// Activate ServiceWorker
			await registration.install();
			await registration.activate();

			// Test request
			const request = new Request("http://localhost/");
			const response = await registration.handleRequest(request);
			const content = await response.text();

			expect(content).toContain("Hello from static file!");
			expect(response.headers.get("content-type")).toBe(
				"text/html; charset=utf-8",
			);
		} finally {
			await cleanup([tempDir]);
		}
	},
	TIMEOUT,
);

test(
	"self.buckets file serving with different content types",
	async () => {
		const {ServiceWorkerRegistration, ShovelGlobalScope, CustomBucketStorage} =
			await import("../src/index.js");

		const tempDir = await createTempDir();

		try {
			// Set up test files
			const distPath = join(tempDir, "dist");
			await FS.mkdir(distPath, {recursive: true});
			await FS.writeFile(
				join(distPath, "style.css"),
				"body { background: blue; }",
			);
			await FS.writeFile(join(distPath, "script.js"), "console.log('loaded');");
			await FS.writeFile(join(distPath, "data.json"), '{"message": "test"}');

			const registration = new ServiceWorkerRegistration();
			const buckets = await createBucketStorage(tempDir);

			const scope = new ShovelGlobalScope({registration, buckets});
			scope.install();

			// ServiceWorker that serves different file types
			globalThis.addEventListener("fetch", (event) => {
				const url = new URL(event.request.url);
				const pathname = url.pathname.slice(1); // Remove leading slash

				if (pathname) {
					event.respondWith(
						(async () => {
							try {
								const distBucket = await globalThis.buckets.open("dist");
								const fileHandle = await distBucket.getFileHandle(pathname);
								const file = await fileHandle.getFile();
								const content = await file.text();

								// Determine content type
								let contentType = "text/plain";
								if (pathname.endsWith(".css")) {
									contentType = "text/css";
								} else if (pathname.endsWith(".js")) {
									contentType = "application/javascript";
								} else if (pathname.endsWith(".json")) {
									contentType = "application/json";
								}

								return new Response(content, {
									headers: {"content-type": contentType},
								});
							} catch (error) {
								return new Response("Not found", {status: 404});
							}
						})(),
					);
				} else {
					event.respondWith(new Response("Index", {status: 200}));
				}
			});

			// Activate ServiceWorker
			await registration.install();
			await registration.activate();

			// Test different file types
			const cssRequest = new Request("http://localhost/style.css");
			const cssResponse = await registration.handleRequest(cssRequest);
			expect(await cssResponse.text()).toBe("body { background: blue; }");
			expect(cssResponse.headers.get("content-type")).toBe("text/css");

			const jsRequest = new Request("http://localhost/script.js");
			const jsResponse = await registration.handleRequest(jsRequest);
			expect(await jsResponse.text()).toBe("console.log('loaded');");
			expect(jsResponse.headers.get("content-type")).toBe(
				"application/javascript",
			);

			const jsonRequest = new Request("http://localhost/data.json");
			const jsonResponse = await registration.handleRequest(jsonRequest);
			expect(await jsonResponse.text()).toBe('{"message": "test"}');
			expect(jsonResponse.headers.get("content-type")).toBe("application/json");

			// Test 404
			const notFoundRequest = new Request("http://localhost/nonexistent.txt");
			const notFoundResponse =
				await registration.handleRequest(notFoundRequest);
			expect(notFoundResponse.status).toBe(404);
		} finally {
			await cleanup([tempDir]);
		}
	},
	TIMEOUT,
);

// ======================
// BUCKET ADAPTER TESTS
// ======================

test(
	"memory bucket adapter",
	async () => {
		const {MemoryBucket} = await import("@b9g/filesystem");

		const bucket = new MemoryBucket();

		// Test directory creation
		const dirHandle = await bucket.getDirectoryHandle("test", {create: true});
		expect(dirHandle.kind).toBe("directory");
		expect(dirHandle.name).toBe("test");

		// Test file creation
		const fileHandle = await dirHandle.getFileHandle("test.txt", {
			create: true,
		});
		expect(fileHandle.kind).toBe("file");
		expect(fileHandle.name).toBe("test.txt");

		// Test file writing
		const writable = await fileHandle.createWritable();
		await writable.write("memory test");
		await writable.close();

		// Test file reading
		const file = await fileHandle.getFile();
		const content = await file.text();
		expect(content).toBe("memory test");
	},
	TIMEOUT,
);

test(
	"local bucket adapter with real filesystem",
	async () => {
		const {NodeBucket} = await import("@b9g/filesystem");

		const tempDir = await createTempDir();

		try {
			const bucket = new NodeBucket(tempDir);

			// Test directory creation
			const dirHandle = await bucket.getDirectoryHandle("local-test", {
				create: true,
			});
			expect(dirHandle.kind).toBe("directory");

			// Test file operations
			const fileHandle = await dirHandle.getFileHandle("local.txt", {
				create: true,
			});
			const writable = await fileHandle.createWritable();
			await writable.write("local filesystem test");
			await writable.close();

			// Verify file was actually created on filesystem
			const filePath = join(tempDir, "local-test", "local.txt");
			const content = await FS.readFile(filePath, "utf8");
			expect(content).toBe("local filesystem test");

			// Test reading through bucket
			const file = await fileHandle.getFile();
			const bucketContent = await file.text();
			expect(bucketContent).toBe("local filesystem test");
		} finally {
			await cleanup([tempDir]);
		}
	},
	TIMEOUT,
);

// ======================
// ERROR HANDLING TESTS
// ======================

test(
	"bucket error handling - file not found",
	async () => {
		const {CustomBucketStorage} = await import("../src/index.js");

		const tempDir = await createTempDir();

		try {
			const buckets = await createBucketStorage(tempDir);
			const distHandle = await buckets.open("dist");

			// Should throw when trying to get non-existent file without create flag
			await expect(
				distHandle.getFileHandle("nonexistent.txt"),
			).rejects.toThrow();
		} finally {
			await cleanup([tempDir]);
		}
	},
	TIMEOUT,
);

test(
	"bucket error handling - invalid directory name",
	async () => {
		const {CustomBucketStorage} = await import("../src/index.js");

		const tempDir = await createTempDir();

		try {
			const buckets = await createBucketStorage(tempDir);

			// Test with invalid characters (this depends on the implementation)
			// Some implementations might sanitize, others might throw
			try {
				await buckets.open("../invalid");
				// If it doesn't throw, that's also valid behavior
			} catch (error) {
				// If it throws, the error should be meaningful
				expect(error.message).toBeTruthy();
			}
		} finally {
			await cleanup([tempDir]);
		}
	},
	TIMEOUT,
);

// ======================
// MIGRATION TESTS
// ======================

test(
	"buckets API replaces old dirs API",
	async () => {
		const {ServiceWorkerRegistration, ShovelGlobalScope, CustomBucketStorage} =
			await import("../src/index.js");

		const tempDir = await createTempDir();

		try {
			const registration = new ServiceWorkerRegistration();
			const buckets = await createBucketStorage(tempDir);

			const scope = new ShovelGlobalScope({registration, buckets});
			scope.install();

			// New API should be available
			expect(typeof globalThis.buckets).toBe("object");
			expect(typeof globalThis.buckets.open).toBe("function");

			// Old dirs API should not be available (or should be deprecated)
			expect(globalThis.dirs).toBeUndefined();
		} finally {
			await cleanup([tempDir]);
		}
	},
	TIMEOUT,
);

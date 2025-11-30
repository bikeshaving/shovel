import {test, expect, describe, beforeEach} from "bun:test";
import {
	ShovelFileHandle,
	ShovelDirectoryHandle,
	type FileSystemBackend,
} from "../src/index.js";

describe("Filesystem Handles", () => {
	let mockBackend: FileSystemBackend;

	beforeEach(() => {
		// Mock filesystem backend
		mockBackend = {
			async stat(path: string) {
				const files: Record<string, {kind: "file" | "directory"}> = {
					"/": {kind: "directory"},
					"/app.js": {kind: "file"},
					"/assets": {kind: "directory"},
					"/assets/style.css": {kind: "file"},
				};
				return files[path] || null;
			},

			async readFile(path: string) {
				const files: Record<string, {content: string; lastModified: number}> = {
					"/app.js": {
						content: "console.log('Hello');",
						lastModified: 1700000000000,
					},
					"/assets/style.css": {
						content: "body { margin: 0; }",
						lastModified: 1700000001000,
					},
				};
				const file = files[path];
				if (!file) throw new Error("NotFoundError");
				return {
					content: new TextEncoder().encode(file.content),
					lastModified: file.lastModified,
				};
			},

			async writeFile(_path: string, _data: Uint8Array) {
				// Mock write - in real test this would update the mock state
			},

			async listDir(path: string) {
				const entries: Record<
					string,
					Array<{name: string; kind: "file" | "directory"}>
				> = {
					"/": [
						{name: "app.js", kind: "file"},
						{name: "assets", kind: "directory"},
					],
					"/assets": [{name: "style.css", kind: "file"}],
				};
				return entries[path] || [];
			},

			async createDir(_path: string) {
				// Mock directory creation
			},

			async remove(_path: string, _recursive?: boolean) {
				// Mock removal
			},
		};
	});

	describe("ShovelFileHandle", () => {
		test("should have correct kind and name", () => {
			const handle = new ShovelFileHandle(mockBackend, "/app.js");
			expect(handle.kind).toBe("file");
			expect(handle.name).toBe("app.js");
		});

		test("should get file content", async () => {
			const handle = new ShovelFileHandle(mockBackend, "/app.js");
			const file = await handle.getFile();

			expect(file.name).toBe("app.js");
			expect(file.type).toMatch(/javascript/);
			expect(await file.text()).toBe("console.log('Hello');");
		});

		test("should get file with correct lastModified from backend", async () => {
			const handle = new ShovelFileHandle(mockBackend, "/app.js");
			const file = await handle.getFile();

			expect(file.lastModified).toBe(1700000000000);
		});

		test("should create writable stream", async () => {
			const handle = new ShovelFileHandle(mockBackend, "/new-file.txt");
			const writable = await handle.createWritable();

			expect(writable).toBeInstanceOf(WritableStream);
		});

		test("should detect same entry", async () => {
			const handle1 = new ShovelFileHandle(mockBackend, "/app.js");
			const handle2 = new ShovelFileHandle(mockBackend, "/app.js");
			const handle3 = new ShovelFileHandle(mockBackend, "/other.js");

			expect(await handle1.isSameEntry(handle2)).toBe(true);
			expect(await handle1.isSameEntry(handle3)).toBe(false);
		});

		test("should always grant permissions", async () => {
			const handle = new ShovelFileHandle(mockBackend, "/app.js");

			expect(await handle.queryPermission()).toBe("granted");
			expect(await handle.requestPermission({mode: "readwrite"})).toBe(
				"granted",
			);
		});
	});

	describe("ShovelDirectoryHandle", () => {
		test("should have correct kind and name", () => {
			const handle = new ShovelDirectoryHandle(mockBackend, "/assets");
			expect(handle.kind).toBe("directory");
			expect(handle.name).toBe("assets");
		});

		test("should get file handle from directory", async () => {
			const dirHandle = new ShovelDirectoryHandle(mockBackend, "/assets");
			const fileHandle = await dirHandle.getFileHandle("style.css");

			expect(fileHandle.kind).toBe("file");
			expect(fileHandle.name).toBe("style.css");
		});

		test("should get directory handle from directory", async () => {
			const rootHandle = new ShovelDirectoryHandle(mockBackend, "/");
			const assetsHandle = await rootHandle.getDirectoryHandle("assets");

			expect(assetsHandle.kind).toBe("directory");
			expect(assetsHandle.name).toBe("assets");
		});

		test("should throw for non-existent file", async () => {
			const dirHandle = new ShovelDirectoryHandle(mockBackend, "/");

			try {
				await dirHandle.getFileHandle("nonexistent.js");
				expect.unreachable();
			} catch (error) {
				expect(error).toBeInstanceOf(DOMException);
				expect((error as DOMException).name).toBe("NotFoundError");
			}
		});

		test("should create file with create option", async () => {
			const dirHandle = new ShovelDirectoryHandle(mockBackend, "/");

			// This should work since we mock writeFile
			const fileHandle = await dirHandle.getFileHandle("new.js", {
				create: true,
			});
			expect(fileHandle.kind).toBe("file");
			expect(fileHandle.name).toBe("new.js");
		});

		test("should validate names and reject path separators", async () => {
			const dirHandle = new ShovelDirectoryHandle(mockBackend, "/");

			try {
				await dirHandle.getFileHandle("../etc/passwd");
				expect.unreachable();
			} catch (error) {
				expect(error).toBeInstanceOf(DOMException);
				expect((error as DOMException).name).toBe("NotAllowedError");
			}
		});

		test("should iterate directory entries", async () => {
			const dirHandle = new ShovelDirectoryHandle(mockBackend, "/");
			const entries: [string, FileSystemHandle][] = [];

			for await (const entry of dirHandle.entries()) {
				entries.push(entry);
			}

			expect(entries).toHaveLength(2);
			expect(entries[0][0]).toBe("app.js");
			expect(entries[0][1].kind).toBe("file");
			expect(entries[1][0]).toBe("assets");
			expect(entries[1][1].kind).toBe("directory");
		});

		test("should iterate directory keys", async () => {
			const dirHandle = new ShovelDirectoryHandle(mockBackend, "/");
			const keys: string[] = [];

			for await (const key of dirHandle.keys()) {
				keys.push(key);
			}

			expect(keys).toEqual(["app.js", "assets"]);
		});

		test("should resolve relative paths", async () => {
			const rootHandle = new ShovelDirectoryHandle(mockBackend, "/");
			const fileHandle = new ShovelFileHandle(mockBackend, "/assets/style.css");

			const resolved = await rootHandle.resolve(fileHandle);
			expect(resolved).toEqual(["assets", "style.css"]);
		});

		test("should return null for non-descendant paths", async () => {
			const assetsHandle = new ShovelDirectoryHandle(mockBackend, "/assets");
			const fileHandle = new ShovelFileHandle(mockBackend, "/app.js");

			const resolved = await assetsHandle.resolve(fileHandle);
			expect(resolved).toBeNull();
		});
	});

	describe("Name validation", () => {
		test("should reject empty names", async () => {
			const dirHandle = new ShovelDirectoryHandle(mockBackend, "/");

			try {
				await dirHandle.getFileHandle("");
				expect.unreachable();
			} catch (error) {
				expect(error).toBeInstanceOf(DOMException);
				expect((error as DOMException).name).toBe("NotAllowedError");
			}
		});

		test("should reject dot and double-dot", async () => {
			const dirHandle = new ShovelDirectoryHandle(mockBackend, "/");

			try {
				await dirHandle.getFileHandle(".");
				expect.unreachable();
			} catch (error) {
				expect(error).toBeInstanceOf(DOMException);
			}

			try {
				await dirHandle.getFileHandle("..");
				expect.unreachable();
			} catch (error) {
				expect(error).toBeInstanceOf(DOMException);
			}
		});
	});
});

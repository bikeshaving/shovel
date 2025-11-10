import {test, expect, describe} from "bun:test";
import {
	R2FileSystemFileHandle,
	R2FileSystemDirectoryHandle,
	R2FileSystemAdapter,
	R2FileSystemWritableFileStream,
} from "../src/index.js";

describe("R2 Filesystem", () => {
	// Mock R2Bucket interface for testing
	const mockR2Bucket = {
		get: () => Promise.resolve({
			arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
			uploaded: new Date(),
			httpMetadata: {contentType: "application/json"},
		}),
		put: () => Promise.resolve(),
		head: () => Promise.resolve({}),
		delete: () => Promise.resolve(),
		list: () => Promise.resolve({
			objects: [
				{key: "test/file1.txt"},
				{key: "test/file2.js"},
			],
			delimitedPrefixes: ["test/subdir/"],
		}),
	};

	describe("R2FileSystemWritableFileStream", () => {
		test("should be a WritableStream instance", () => {
			const stream = new R2FileSystemWritableFileStream(
				mockR2Bucket,
				"test/file.txt",
			);
			
			expect(stream).toBeInstanceOf(WritableStream);
		});
	});

	describe("R2FileSystemFileHandle", () => {
		test("should have correct properties", () => {
			const handle = new R2FileSystemFileHandle(
				mockR2Bucket,
				"path/to/file.txt",
			);

			expect(handle.kind).toBe("file");
			expect(handle.name).toBe("file.txt");
		});

		test("should extract filename from path", () => {
			const handle1 = new R2FileSystemFileHandle(
				mockR2Bucket,
				"simple.txt",
			);
			expect(handle1.name).toBe("simple.txt");

			const handle2 = new R2FileSystemFileHandle(
				mockR2Bucket,
				"deep/nested/path/file.js",
			);
			expect(handle2.name).toBe("file.js");
		});

		test("should detect same entry correctly", async () => {
			const handle1 = new R2FileSystemFileHandle(
				mockR2Bucket,
				"test/file.txt",
			);
			const handle2 = new R2FileSystemFileHandle(
				mockR2Bucket,
				"test/file.txt",
			);
			const handle3 = new R2FileSystemFileHandle(
				mockR2Bucket,
				"test/other.txt",  // Different key
			);

			expect(await handle1.isSameEntry(handle2)).toBe(true);
			expect(await handle1.isSameEntry(handle3)).toBe(false);
		});

		test("should always grant permissions", async () => {
			const handle = new R2FileSystemFileHandle(
				mockR2Bucket,
				"test/file.txt",
			);

			expect(await handle.queryPermission()).toBe("granted");
			expect(await handle.requestPermission()).toBe("granted");
		});

		test("should create writable stream", async () => {
			const handle = new R2FileSystemFileHandle(
				mockR2Bucket,
				"test/file.txt",
			);

			const writable = await handle.createWritable();
			expect(writable).toBeInstanceOf(WritableStream);
		});

		test("should reject sync access handle", async () => {
			const handle = new R2FileSystemFileHandle(
				mockR2Bucket,
				"test/file.txt",
			);

			try {
				await handle.createSyncAccessHandle();
				expect.unreachable();
			} catch (error) {
				expect(error).toBeInstanceOf(DOMException);
				expect((error as DOMException).name).toBe("InvalidStateError");
			}
		});

		test("should get mime type correctly", () => {
			const handle = new R2FileSystemFileHandle(
				mockR2Bucket,
				"test.json",
			);
			
			// Access private method through casting
			const mimeType = (handle as any).getMimeType("test.json");
			expect(mimeType).toBe("application/json");
		});
	});

	describe("R2FileSystemDirectoryHandle", () => {
		test("should have correct properties", () => {
			const handle = new R2FileSystemDirectoryHandle(
				mockR2Bucket,
				"path/to/dir",
			);

			expect(handle.kind).toBe("directory");
			expect(handle.name).toBe("dir");
		});

		test("should handle root directory name", () => {
			const handle = new R2FileSystemDirectoryHandle(
				mockR2Bucket,
				"",
			);
			expect(handle.name).toBe("root");
		});

		test("should normalize prefix by removing trailing slash", () => {
			const handle1 = new R2FileSystemDirectoryHandle(
				mockR2Bucket,
				"test/dir/",
			);
			const handle2 = new R2FileSystemDirectoryHandle(
				mockR2Bucket,
				"test/dir",
			);

			// Both should be treated the same
			expect(handle1.name).toBe("dir");
			expect(handle2.name).toBe("dir");
		});

		test("should detect same entry correctly", async () => {
			const handle1 = new R2FileSystemDirectoryHandle(
				mockR2Bucket,
				"test/dir",
			);
			const handle2 = new R2FileSystemDirectoryHandle(
				mockR2Bucket,
				"test/dir",
			);
			const handle3 = new R2FileSystemDirectoryHandle(
				mockR2Bucket,
				"test/otherdir",  // Different prefix
			);

			expect(await handle1.isSameEntry(handle2)).toBe(true);
			expect(await handle1.isSameEntry(handle3)).toBe(false);
		});

		test("should always grant permissions", async () => {
			const handle = new R2FileSystemDirectoryHandle(
				mockR2Bucket,
				"test/dir",
			);

			expect(await handle.queryPermission()).toBe("granted");
			expect(await handle.requestPermission()).toBe("granted");
		});

		test("should return null for resolve (not implemented)", async () => {
			const handle = new R2FileSystemDirectoryHandle(
				mockR2Bucket,
				"test/dir",
			);
			const fileHandle = new R2FileSystemFileHandle(
				mockR2Bucket,
				"test/dir/file.txt",
			);

			const result = await handle.resolve(fileHandle);
			expect(result).toBeNull();
		});
	});

	describe("R2FileSystemAdapter", () => {
		test("should create adapter with correct config", () => {
			const adapter = new R2FileSystemAdapter(mockR2Bucket, {
				name: "test-r2",
			});

			const config = adapter.getConfig();
			expect(config.name).toBe("test-r2");
		});

		test("should use default name when not provided", () => {
			const adapter = new R2FileSystemAdapter(mockR2Bucket);
			const config = adapter.getConfig();
			expect(config.name).toBe("r2");
		});

		test("should create filesystem root handle", async () => {
			const adapter = new R2FileSystemAdapter(mockR2Bucket);
			const root = await adapter.getFileSystemRoot("my-app");

			expect(root).toBeInstanceOf(R2FileSystemDirectoryHandle);
			expect(root.kind).toBe("directory");
			expect(root.name).toBe("my-app");
		});

		test("should create default filesystem root", async () => {
			const adapter = new R2FileSystemAdapter(mockR2Bucket);
			const root = await adapter.getFileSystemRoot();

			expect(root).toBeInstanceOf(R2FileSystemDirectoryHandle);
			expect(root.kind).toBe("directory");
			expect(root.name).toBe("default");
		});

		test("should dispose without error", async () => {
			const adapter = new R2FileSystemAdapter(mockR2Bucket);
			// Should not throw
			await adapter.dispose();
			expect(true).toBe(true);
		});
	});
});
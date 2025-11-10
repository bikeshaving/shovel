import {test, expect, describe} from "bun:test";
import {
	S3FileSystemFileHandle,
	S3FileSystemDirectoryHandle,
	S3FileSystemAdapter,
	S3FileSystemWritableFileStream,
} from "../src/index.js";

describe("S3 Filesystem", () => {
	const mockS3Client = {
		send: () => Promise.resolve({}),
	};
	const testBucket = "test-bucket";

	describe("S3FileSystemWritableFileStream", () => {
		test("should be a WritableStream instance", () => {
			const stream = new S3FileSystemWritableFileStream(
				mockS3Client,
				testBucket,
				"test/file.txt",
			);

			expect(stream).toBeInstanceOf(WritableStream);
		});
	});

	describe("S3FileSystemFileHandle", () => {
		test("should have correct properties", () => {
			const handle = new S3FileSystemFileHandle(
				mockS3Client,
				testBucket,
				"path/to/file.txt",
			);

			expect(handle.kind).toBe("file");
			expect(handle.name).toBe("file.txt");
		});

		test("should extract filename from path", () => {
			const handle1 = new S3FileSystemFileHandle(
				mockS3Client,
				testBucket,
				"simple.txt",
			);
			expect(handle1.name).toBe("simple.txt");

			const handle2 = new S3FileSystemFileHandle(
				mockS3Client,
				testBucket,
				"deep/nested/path/file.js",
			);
			expect(handle2.name).toBe("file.js");
		});

		test("should detect same entry correctly", async () => {
			const handle1 = new S3FileSystemFileHandle(
				mockS3Client,
				testBucket,
				"test/file.txt",
			);
			const handle2 = new S3FileSystemFileHandle(
				mockS3Client,
				testBucket,
				"test/file.txt",
			);
			const handle3 = new S3FileSystemFileHandle(
				mockS3Client,
				"other-bucket",
				"test/file.txt",
			);
			const handle4 = new S3FileSystemFileHandle(
				mockS3Client,
				testBucket,
				"test/other.txt",
			);

			expect(await handle1.isSameEntry(handle2)).toBe(true);
			expect(await handle1.isSameEntry(handle3)).toBe(false); // Different bucket
			expect(await handle1.isSameEntry(handle4)).toBe(false); // Different key
		});

		test("should always grant permissions", async () => {
			const handle = new S3FileSystemFileHandle(
				mockS3Client,
				testBucket,
				"test/file.txt",
			);

			expect(await handle.queryPermission()).toBe("granted");
			expect(await handle.requestPermission()).toBe("granted");
		});

		test("should create writable stream", async () => {
			const handle = new S3FileSystemFileHandle(
				mockS3Client,
				testBucket,
				"test/file.txt",
			);

			const writable = await handle.createWritable();
			expect(writable).toBeInstanceOf(WritableStream);
		});

		test("should reject sync access handle", async () => {
			const handle = new S3FileSystemFileHandle(
				mockS3Client,
				testBucket,
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
	});

	describe("S3FileSystemDirectoryHandle", () => {
		test("should have correct properties", () => {
			const handle = new S3FileSystemDirectoryHandle(
				mockS3Client,
				testBucket,
				"path/to/dir",
			);

			expect(handle.kind).toBe("directory");
			expect(handle.name).toBe("dir");
		});

		test("should handle root directory name", () => {
			const handle = new S3FileSystemDirectoryHandle(
				mockS3Client,
				testBucket,
				"",
			);
			expect(handle.name).toBe("root");
		});

		test("should normalize prefix by removing trailing slash", () => {
			const handle1 = new S3FileSystemDirectoryHandle(
				mockS3Client,
				testBucket,
				"test/dir/",
			);
			const handle2 = new S3FileSystemDirectoryHandle(
				mockS3Client,
				testBucket,
				"test/dir",
			);

			// Both should be treated the same
			expect(handle1.name).toBe("dir");
			expect(handle2.name).toBe("dir");
		});

		test("should detect same entry correctly", async () => {
			const handle1 = new S3FileSystemDirectoryHandle(
				mockS3Client,
				testBucket,
				"test/dir",
			);
			const handle2 = new S3FileSystemDirectoryHandle(
				mockS3Client,
				testBucket,
				"test/dir",
			);
			const handle3 = new S3FileSystemDirectoryHandle(
				mockS3Client,
				"other-bucket",
				"test/dir",
			);

			expect(await handle1.isSameEntry(handle2)).toBe(true);
			expect(await handle1.isSameEntry(handle3)).toBe(false);
		});

		test("should always grant permissions", async () => {
			const handle = new S3FileSystemDirectoryHandle(
				mockS3Client,
				testBucket,
				"test/dir",
			);

			expect(await handle.queryPermission()).toBe("granted");
			expect(await handle.requestPermission()).toBe("granted");
		});

		test("should return null for resolve (not implemented)", async () => {
			const handle = new S3FileSystemDirectoryHandle(
				mockS3Client,
				testBucket,
				"test/dir",
			);
			const fileHandle = new S3FileSystemFileHandle(
				mockS3Client,
				testBucket,
				"test/dir/file.txt",
			);

			const result = await handle.resolve(fileHandle);
			expect(result).toBeNull();
		});
	});

	describe("S3FileSystemAdapter", () => {
		test("should create adapter with correct config", () => {
			const adapter = new S3FileSystemAdapter(mockS3Client, testBucket, {
				name: "test-s3",
			});

			const config = adapter.getConfig();
			expect(config.name).toBe("test-s3");
		});

		test("should use default name when not provided", () => {
			const adapter = new S3FileSystemAdapter(mockS3Client, testBucket);
			const config = adapter.getConfig();
			expect(config.name).toBe("s3");
		});

		test("should create filesystem root handle", async () => {
			const adapter = new S3FileSystemAdapter(mockS3Client, testBucket);
			const root = await adapter.getFileSystemRoot("my-app");

			expect(root).toBeInstanceOf(S3FileSystemDirectoryHandle);
			expect(root.kind).toBe("directory");
			expect(root.name).toBe("my-app");
		});

		test("should create default filesystem root", async () => {
			const adapter = new S3FileSystemAdapter(mockS3Client, testBucket);
			const root = await adapter.getFileSystemRoot();

			expect(root).toBeInstanceOf(S3FileSystemDirectoryHandle);
			expect(root.kind).toBe("directory");
			expect(root.name).toBe("default");
		});

		test("should dispose without error", async () => {
			const adapter = new S3FileSystemAdapter(mockS3Client, testBucket);
			// Should not throw
			await adapter.dispose();
			expect(true).toBe(true);
		});
	});
});

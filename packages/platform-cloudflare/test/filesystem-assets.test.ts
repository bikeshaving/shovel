import {describe, test, expect, beforeAll, afterAll} from "bun:test";
import {Miniflare} from "miniflare";
import * as path from "path";
import * as fs from "fs/promises";
import {CFAssetsBinding, CFAssetsDirectoryHandle} from "../src/directories.js";

describe("CFAssetsDirectoryHandle", () => {
	let mf: Miniflare;
	let assets: CFAssetsBinding;
	const publicDir = path.resolve(import.meta.dir, "static-fixtures");

	beforeAll(async () => {
		// Create test static files
		await fs.mkdir(publicDir, {recursive: true});
		await fs.mkdir(path.join(publicDir, "assets"), {recursive: true});
		await fs.writeFile(
			path.join(publicDir, "assets", "style.abc123.css"),
			"body { color: blue; }",
		);
		await fs.writeFile(
			path.join(publicDir, "assets", "app.def456.js"),
			'console.log("Hello");',
		);
		await fs.writeFile(path.join(publicDir, "index.html"), "<html></html>");

		mf = new Miniflare({
			modules: true,
			script: `export default { fetch() { return new Response("ok"); } }`,
			assets: {
				directory: publicDir,
				binding: "ASSETS",
				routerConfig: {invoke_user_worker_ahead_of_assets: true},
			},
		});

		const env = await mf.getBindings();
		assets = env.ASSETS as CFAssetsBinding;
	});

	afterAll(async () => {
		await mf.dispose();
		await fs.rm(publicDir, {recursive: true});
	});

	test("creates handle with correct name and kind", () => {
		const handle = new CFAssetsDirectoryHandle(assets, "/assets");
		expect(handle.kind).toBe("directory");
		expect(handle.name).toBe("assets");
	});

	test("root directory has 'assets' as default name", () => {
		const handle = new CFAssetsDirectoryHandle(assets, "/");
		expect(handle.name).toBe("assets");
	});

	test("getFileHandle returns file handle for existing file", async () => {
		const dir = new CFAssetsDirectoryHandle(assets, "/assets");
		const fileHandle = await dir.getFileHandle("style.abc123.css");

		expect(fileHandle.kind).toBe("file");
		expect(fileHandle.name).toBe("style.abc123.css");
	});

	test("getFileHandle throws NotFoundError for missing file", async () => {
		const dir = new CFAssetsDirectoryHandle(assets, "/assets");

		expect(dir.getFileHandle("nonexistent.txt")).rejects.toThrow(
			"could not be found",
		);
	});

	test("getFile returns File with correct content", async () => {
		const dir = new CFAssetsDirectoryHandle(assets, "/assets");
		const fileHandle = await dir.getFileHandle("style.abc123.css");
		const file = await fileHandle.getFile();

		expect(file.name).toBe("style.abc123.css");
		expect(file.type).toBe("text/css; charset=utf-8");
		expect(await file.text()).toBe("body { color: blue; }");
	});

	test("getDirectoryHandle navigates to subdirectory", async () => {
		const root = new CFAssetsDirectoryHandle(assets, "/");
		const assetsDir = await root.getDirectoryHandle("assets");

		expect(assetsDir.name).toBe("assets");

		const fileHandle = await assetsDir.getFileHandle("app.def456.js");
		const content = await (await fileHandle.getFile()).text();
		expect(content).toBe('console.log("Hello");');
	});

	test("removeEntry throws NotAllowedError (read-only)", async () => {
		const dir = new CFAssetsDirectoryHandle(assets, "/");
		expect(dir.removeEntry("index.html")).rejects.toThrow("read-only");
	});

	test("createWritable throws NotAllowedError (read-only)", async () => {
		const dir = new CFAssetsDirectoryHandle(assets, "/");
		const fileHandle = await dir.getFileHandle("index.html");

		expect(fileHandle.createWritable()).rejects.toThrow("read-only");
	});

	test("entries() throws NotSupportedError", async () => {
		const dir = new CFAssetsDirectoryHandle(assets, "/");

		expect(async () => {
			for await (const _ of dir.entries()) {
				// Should not reach here
			}
		}).toThrow("not supported");
	});

	test("isSameEntry returns true for same path", async () => {
		const dir1 = new CFAssetsDirectoryHandle(assets, "/assets");
		const dir2 = new CFAssetsDirectoryHandle(assets, "/assets");

		expect(await dir1.isSameEntry(dir2)).toBe(true);
	});

	test("isSameEntry returns false for different paths", async () => {
		const dir1 = new CFAssetsDirectoryHandle(assets, "/assets");
		const dir2 = new CFAssetsDirectoryHandle(assets, "/other");

		expect(await dir1.isSameEntry(dir2)).toBe(false);
	});
});

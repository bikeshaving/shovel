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

	// The ASSETS binding has no list API, so enumeration reads the asset
	// manifest the build bundles into the worker. Without one there is nothing
	// to list; with one, the directory enumerates like any other.
	test("entries() throws NotSupportedError without a manifest", async () => {
		const dir = new CFAssetsDirectoryHandle(assets, "/");

		expect(async () => {
			for await (const _ of dir.entries()) {
				// Should not reach here
			}
		}).toThrow("not supported");
	});

	describe("enumeration via the asset manifest", () => {
		const manifest = {
			assets: {
				"src/styles/style.css": {url: "/assets/style.abc123.css"},
				"src/app.ts": {url: "/assets/app.def456.js"},
				"src/index.html": {url: "/index.html"},
			},
		};

		test("keys() lists the direct children of the base path", async () => {
			const dir = new CFAssetsDirectoryHandle(assets, "/assets", manifest);
			const names: string[] = [];
			for await (const name of dir.keys()) names.push(name);
			expect(names.sort()).toEqual(["app.def456.js", "style.abc123.css"]);
		});

		test("a deeper asset surfaces as a subdirectory, not a file", async () => {
			const dir = new CFAssetsDirectoryHandle(assets, "/", manifest);
			const entries: Array<[string, string]> = [];
			for await (const [name, handle] of dir.entries()) {
				entries.push([name, handle.kind]);
			}
			expect(entries.sort()).toEqual([
				["assets", "directory"],
				["index.html", "file"],
			]);
		});

		test("values() yield handles that read real content", async () => {
			const dir = new CFAssetsDirectoryHandle(assets, "/assets", manifest);
			const byName = new Map<string, FileSystemFileHandle>();
			for await (const handle of dir.values()) {
				byName.set(handle.name, handle as FileSystemFileHandle);
			}

			const css = byName.get("style.abc123.css")!;
			expect(await (await css.getFile()).text()).toBe("body { color: blue; }");
		});

		test("navigating into a subdirectory keeps it enumerable", async () => {
			const root = new CFAssetsDirectoryHandle(assets, "/", manifest);
			// getDirectoryHandle is typed to the DOM handle, which predates
			// keys()/entries() — the concrete class has them.
			const sub = (await root.getDirectoryHandle(
				"assets",
			)) as CFAssetsDirectoryHandle;
			const names: string[] = [];
			for await (const name of sub.keys()) names.push(name);
			expect(names.sort()).toEqual(["app.def456.js", "style.abc123.css"]);
		});
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

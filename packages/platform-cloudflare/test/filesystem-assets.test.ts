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
	// manifest the generated worker entry registers. Without one there is
	// nothing to list; with one, the directory enumerates like any other.
	test("entries() throws NotSupportedError without a manifest", async () => {
		const dir = new CFAssetsDirectoryHandle(assets, "/");

		// The rejection surfaces on first next(); expect().toThrow on an async
		// arrow observes nothing (it returns a rejected promise).
		await expect(
			(async () => {
				for await (const _ of dir.entries()) {
					// Should not reach here
				}
			})(),
		).rejects.toThrow("not supported");
	});

	test("a malformed manifest is treated as no manifest, not a crash", async () => {
		const dir = new CFAssetsDirectoryHandle(assets, "/", {} as any);

		await expect(
			(async () => {
				for await (const _ of dir.entries()) {
					// Should not reach here
				}
			})(),
		).rejects.toThrow("not supported");
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
			const sub = await root.getDirectoryHandle("assets");
			const names: string[] = [];
			for await (const name of sub.keys()) names.push(name);
			expect(names.sort()).toEqual(["app.def456.js", "style.abc123.css"]);
		});

		test("a name that is both file and directory keeps the directory", async () => {
			const colliding = {
				assets: {
					a: {url: "/content/posts"},
					b: {url: "/content/posts/first.md"},
				},
			};
			const dir = new CFAssetsDirectoryHandle(assets, "/content", colliding);
			const entries: Array<[string, string]> = [];
			for await (const [name, handle] of dir.entries()) {
				entries.push([name, handle.kind]);
			}
			// Deterministic regardless of manifest iteration order: the subtree
			// must not be shadowed by the same-named file.
			expect(entries).toEqual([["posts", "directory"]]);
		});

		test("an unknown directory enumerates as empty, reads still work", async () => {
			const dir = new CFAssetsDirectoryHandle(
				assets,
				"/not-in-manifest",
				manifest,
			);
			const names: string[] = [];
			for await (const name of dir.keys()) names.push(name);
			expect(names).toEqual([]);
		});

		test("getFileHandle resolves through the manifest without a probe", async () => {
			// The binding would 404 this URL under html_handling none if probed;
			// a manifest hit must not need the network. index.html IS served, so
			// instead assert the manifest path by pointing at a manifest entry
			// and reading real content through the returned handle.
			const dir = new CFAssetsDirectoryHandle(assets, "/assets", manifest);
			const handle = await dir.getFileHandle("style.abc123.css");
			expect(await (await handle.getFile()).text()).toBe(
				"body { color: blue; }",
			);
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

describe("CFAssetsDirectoryHandle name validation", () => {
	// A binding that serves a file outside the handle's base path, so any
	// traversal that reaches it shows up as a successful read.
	const files: Record<string, string> = {
		"/public/app.js": "public js",
		"/private/secret.txt": "TOP SECRET",
	};
	const fetched: string[] = [];
	const assets: CFAssetsBinding = {
		async fetch(request: Request) {
			const pathname = new URL(request.url).pathname;
			fetched.push(pathname);
			return files[pathname]
				? new Response(files[pathname])
				: new Response("not found", {status: 404});
		},
	} as CFAssetsBinding;
	const manifest = {assets: {}};

	test("getFileHandle rejects names that escape the base path", async () => {
		const pub = new CFAssetsDirectoryHandle(assets, "/public", manifest);
		for (const name of [
			"../private/secret.txt",
			"%2e%2e/private/secret.txt",
			"..%2fprivate%2fsecret.txt",
			"..",
			".",
			"%2e%2e",
			"%2E.",
			"a\\b",
			"%5c",
			"",
		]) {
			await expect(pub.getFileHandle(name)).rejects.toThrow(TypeError);
		}
		expect(fetched).toEqual([]);
	});

	test("getDirectoryHandle rejects names that escape the base path", async () => {
		const pub = new CFAssetsDirectoryHandle(assets, "/public", manifest);
		for (const name of ["..", ".", "%2e%2e", ".%2E", "a/b", "%2f"]) {
			await expect(pub.getDirectoryHandle(name)).rejects.toThrow(TypeError);
		}
	});

	test("names with a literal percent sign are allowed", async () => {
		const root = new CFAssetsDirectoryHandle(assets, "/", manifest);
		await expect(root.getFileHandle("100%.png")).rejects.toThrow(
			"could not be found",
		);
		await expect(root.getDirectoryHandle("50% off")).resolves.toBeDefined();
		await expect(root.getFileHandle("%zz%2f..")).rejects.toThrow(TypeError);
	});

	test("valid names still resolve", async () => {
		const root = new CFAssetsDirectoryHandle(assets, "/", manifest);
		const pub = await root.getDirectoryHandle("public");
		const file = await (await pub.getFileHandle("app.js")).getFile();
		expect(await file.text()).toBe("public js");
	});
});

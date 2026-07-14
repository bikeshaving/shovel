import {test, expect, describe, beforeEach} from "bun:test";
import {createDirectorySnapshotPlugin} from "../src/plugins/directory-snapshot.js";
import {generateConfigModule} from "../src/utils/config.js";
import {buildForProduction} from "../src/commands/build.js";
import * as ESBuild from "esbuild";
import {findProjectRoot} from "../src/utils/project.js";
import {mkdtemp, writeFile, mkdir, readdir, readFile} from "fs/promises";
import {symlinkSync} from "fs";
import {tmpdir} from "os";
import {join} from "path";

// The temp fixture projects have no node_modules; let esbuild resolve
// @b9g/filesystem/memory from the repo (the real bundler passes nodePaths too).
const REPO_NODE_MODULES = join(findProjectRoot(), "node_modules");

/**
 * End-to-end tests for the build-time directory snapshot: a source directory is
 * baked into the bundle and exposed as a populated MemoryDirectory, so
 * self.directories.open(name) works on filesystem-less platforms (Cloudflare).
 */

async function makeProject(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "dir-snapshot-"));
	await writeFile(
		join(root, "shovel.json"),
		JSON.stringify({directories: {content: {snapshot: "./content"}}}),
	);
	await mkdir(join(root, "content", "guides"), {recursive: true});
	await mkdir(join(root, "content", "img"), {recursive: true});
	await writeFile(join(root, "content", "index.md"), "# Home\n");
	await writeFile(join(root, "content", "guides", "intro.md"), "intro body");
	// Binary file to prove bytes survive base64 round-trip through the bundle.
	await writeFile(
		join(root, "content", "img", "pixel.bin"),
		Buffer.from([0x00, 0x01, 0x02, 0xff]),
	);
	return root;
}

/** Bundle an entry that re-exports the snapshot factory, then import the output. */
async function buildAndLoad(root: string): Promise<(name: string) => any> {
	await writeFile(
		join(root, "entry.js"),
		`export {default as makeDir} from "shovel:directory-snapshot:content";\n`,
	);
	const outfile = join(root, "out.mjs");
	await ESBuild.build({
		entryPoints: [join(root, "entry.js")],
		bundle: true,
		format: "esm",
		platform: "node",
		outfile,
		absWorkingDir: root,
		nodePaths: [REPO_NODE_MODULES],
		plugins: [createDirectorySnapshotPlugin(root)],
	});
	// eslint-disable-next-line no-restricted-syntax -- loading the built artifact
	const mod = await import(outfile);
	return mod.makeDir;
}

describe("directory snapshot — build to runtime", () => {
	let root: string;
	beforeEach(async () => {
		root = await makeProject();
	});

	test("baked directory reads top-level files", async () => {
		const makeDir = await buildAndLoad(root);
		const dir = makeDir("content");
		const fh = await dir.getFileHandle("index.md");
		expect(await (await fh.getFile()).text()).toBe("# Home\n");
	});

	test("baked directory enumerates (works where CF assets dir throws)", async () => {
		const makeDir = await buildAndLoad(root);
		const dir = makeDir("content");
		const names: string[] = [];
		for await (const name of dir.keys()) names.push(name);
		expect(names.sort()).toEqual(["guides", "img", "index.md"]);
	});

	test("nested directories and binary content survive the bundle", async () => {
		const makeDir = await buildAndLoad(root);
		const dir = makeDir("content");

		const guides = await dir.getDirectoryHandle("guides");
		const intro = await guides.getFileHandle("intro.md");
		expect(await (await intro.getFile()).text()).toBe("intro body");

		const img = await dir.getDirectoryHandle("img");
		const px = await img.getFileHandle("pixel.bin");
		const bytes = new Uint8Array(await (await px.getFile()).arrayBuffer());
		expect(Array.from(bytes)).toEqual([0x00, 0x01, 0x02, 0xff]);
	});

	test("snapshot source escaping the project root is rejected", async () => {
		await writeFile(
			join(root, "shovel.json"),
			JSON.stringify({directories: {content: {snapshot: "../../etc"}}}),
		);
		await writeFile(
			join(root, "entry.js"),
			`export {default} from "shovel:directory-snapshot:content";\n`,
		);
		const build = ESBuild.build({
			entryPoints: [join(root, "entry.js")],
			bundle: true,
			format: "esm",
			platform: "node",
			outfile: join(root, "out2.mjs"),
			absWorkingDir: root,
			plugins: [createDirectorySnapshotPlugin(root)],
		});
		await expect(build).rejects.toThrow(/escapes the project root/);
	});
});

describe("directory snapshot — config generation", () => {
	test("a snapshot directory imports the virtual module as its impl", () => {
		const code = generateConfigModule(
			{directories: {content: {snapshot: "./content"}}} as any,
			{projectDir: "/proj", outDir: "/proj/dist"},
		);
		expect(code).toContain('from "shovel:directory-snapshot:content"');
		// impl must reference the imported factory var, not a module/export.
		expect(code).toContain("directory_content");
		expect(code).not.toContain('"snapshot"');
	});
});

/**
 * The tests above drive esbuild with the plugin directly, so they never touch
 * bundler.ts — a break in the plugin's registration there would go unnoticed.
 * This builds a real project through buildForProduction, on the platform the
 * feature exists for (Cloudflare has no filesystem).
 */
describe("directory snapshot — through the real bundler", () => {
	test("cloudflare production build bakes the snapshot into the worker", async () => {
		const root = await makeProject();
		// A real project: the bundler derives its root from cwd via the
		// nearest package.json, and the emitted module imports
		// @b9g/filesystem/memory by specifier.
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({name: "snap-fixture", version: "0.0.0", type: "module"}),
		);
		symlinkSync(REPO_NODE_MODULES, join(root, "node_modules"));
		await writeFile(
			join(root, "entry.js"),
			`self.addEventListener("fetch", (event) => {
					event.respondWith((async () => {
						const dir = await self.directories.open("content");
						const fh = await dir.getFileHandle("index.md");
						return new Response(await (await fh.getFile()).text());
					})());
				});\n`,
		);

		// eslint-disable-next-line no-restricted-properties -- bundler resolves its root from cwd
		const cwd = process.cwd();
		try {
			process.chdir(root);
			await buildForProduction({
				entrypoint: join(root, "entry.js"),
				outDir: join(root, "dist"),
				platform: "cloudflare",
			});
		} finally {
			process.chdir(cwd);
		}

		const serverDir = join(root, "dist", "server");
		const files = (await readdir(serverDir)).filter((f) => f.endsWith(".js"));
		const bundle = (
			await Promise.all(files.map((f) => readFile(join(serverDir, f), "utf8")))
		).join("\n");

		// Content is inlined as base64, including nested files.
		expect(bundle).toContain(Buffer.from("# Home\n").toString("base64"));
		expect(bundle).toContain(Buffer.from("intro body").toString("base64"));
		expect(bundle).toContain("fromSnapshot");
	}, 30000);
});

import {test, expect, describe, beforeEach} from "bun:test";
import {createDirectorySnapshotPlugin} from "../src/plugins/directory-snapshot.js";
import {generateConfigModule} from "../src/utils/config.js";
import * as ESBuild from "esbuild";
import {findProjectRoot} from "../src/utils/project.js";
import {mkdtemp, writeFile, mkdir} from "fs/promises";
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

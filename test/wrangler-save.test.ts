import * as FS from "fs/promises";
import * as OS from "os";
import {join} from "path";
import {test, expect, describe} from "bun:test";
import {
	computeDesired,
	scaffoldToml,
	syncWranglerConfig,
	usesAssetsDirectory,
} from "../src/utils/wrangler.js";

const CF_DIRECTORIES_MODULE = "@b9g/platform-cloudflare/directories";
const PLATFORM_DEFAULTS = {
	public: {module: CF_DIRECTORIES_MODULE, export: "CloudflareAssetsDirectory"},
};

function desired(assetsDirectory = true) {
	return computeDesired({
		projectRoot: "/proj",
		outDir: "/proj/dist",
		assetsDirectory,
	});
}

async function tempProject(files: Record<string, string>) {
	const dir = join(
		OS.tmpdir(),
		`shovel-wrangler-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await FS.mkdir(dir, {recursive: true});
	for (const [name, contents] of Object.entries(files)) {
		await FS.writeFile(join(dir, name), contents);
	}
	return {
		dir,
		read: (name: string) => FS.readFile(join(dir, name), "utf8"),
		cleanup: () => FS.rm(dir, {recursive: true, force: true}),
	};
}

describe("usesAssetsDirectory", () => {
	test("true under platform defaults alone", () => {
		expect(usesAssetsDirectory(PLATFORM_DEFAULTS, {})).toBe(true);
	});

	test("false when the user overrides public with another module", () => {
		// A user module without an export means that module's default export,
		// not the platform default's named export.
		expect(
			usesAssetsDirectory(PLATFORM_DEFAULTS, {
				public: {module: "@b9g/filesystem/node-fs"},
			}),
		).toBe(false);
	});

	test("true when any user directory targets CloudflareAssetsDirectory", () => {
		expect(
			usesAssetsDirectory(
				{},
				{
					content: {
						module: CF_DIRECTORIES_MODULE,
						export: "CloudflareAssetsDirectory",
					},
				},
			),
		).toBe(true);
	});
});

describe("computeDesired", () => {
	test("paths are project-relative with forward slashes", () => {
		const d = desired();
		expect(d.main).toBe("dist/server/worker.js");
		expect(d.assets.directory).toBe("dist/public/");
		expect(d.assets.htmlHandling).toBe("none");
	});

	test("html_handling not required without an assets directory", () => {
		expect(desired(false).assets.htmlHandling).toBe(null);
	});
});

describe("syncWranglerConfig: no config file", () => {
	test("reports a scaffold without writing when save is off", async () => {
		const project = await tempProject({
			"package.json": JSON.stringify({name: "@me/My App!"}),
		});
		try {
			const result = syncWranglerConfig({
				projectRoot: project.dir,
				desired: desired(),
				save: false,
			});
			expect(result.created).toBe(true);
			expect(result.wrote).toBe(false);
			expect(result.contents).toContain('name = "me-my-app"');
			expect(
				await FS.access(join(project.dir, "wrangler.toml")).then(
					() => true,
					() => false,
				),
			).toBe(false);
		} finally {
			await project.cleanup();
		}
	});

	test("writes a complete scaffold with save", async () => {
		const project = await tempProject({
			"package.json": JSON.stringify({name: "blog"}),
		});
		try {
			const result = syncWranglerConfig({
				projectRoot: project.dir,
				desired: desired(),
				save: true,
			});
			expect(result.wrote).toBe(true);
			const written = await project.read("wrangler.toml");
			expect(written).toBe(scaffoldToml(desired(), "blog"));
			expect(written).toContain('main = "dist/server/worker.js"');
			expect(written).toContain('compatibility_flags = ["nodejs_compat"]');
			expect(written).toContain("[assets]");
			expect(written).toContain('html_handling = "none"');
		} finally {
			await project.cleanup();
		}
	});
});

describe("syncWranglerConfig: wrangler.toml", () => {
	test("fills missing keys and leaves existing lines untouched", async () => {
		const original = [
			`name = "my-worker"`,
			`main = "dist/server/worker.js"`,
			``,
			`[vars]`,
			`FOO = "bar"`,
			``,
			`[assets]`,
			`directory = "dist/public/"`,
			``,
		].join("\n");
		const project = await tempProject({"wrangler.toml": original});
		try {
			const result = syncWranglerConfig({
				projectRoot: project.dir,
				desired: desired(),
				save: true,
			});
			expect(result.wrote).toBe(true);
			const written = await project.read("wrangler.toml");

			// Every original line survives verbatim.
			for (const line of original.split("\n")) {
				expect(written).toContain(line);
			}
			// Top-level additions land before the first table.
			const compatIndex = written.indexOf("compatibility_date");
			expect(compatIndex).toBeGreaterThan(-1);
			expect(compatIndex).toBeLessThan(written.indexOf("[vars]"));
			// [assets] additions land inside [assets], and [vars] stays clean.
			const varsSection = written.slice(
				written.indexOf("[vars]"),
				written.indexOf("[assets]"),
			);
			expect(varsSection).not.toContain("binding");
			const assetsSection = written.slice(written.indexOf("[assets]"));
			expect(assetsSection).toContain(`binding = "ASSETS"`);
			expect(assetsSection).toContain(`html_handling = "none"`);
			// main already existed; it is not duplicated.
			expect(written.split("main =").length).toBe(2);
		} finally {
			await project.cleanup();
		}
	});

	test("appends an [assets] table when absent", async () => {
		const project = await tempProject({
			"wrangler.toml": `name = "w"\nmain = "dist/server/worker.js"\ncompatibility_date = "2025-01-01"\ncompatibility_flags = ["nodejs_compat"]\n`,
		});
		try {
			const result = syncWranglerConfig({
				projectRoot: project.dir,
				desired: desired(),
				save: true,
			});
			expect(result.wrote).toBe(true);
			const written = await project.read("wrangler.toml");
			expect(written).toContain(
				`[assets]\ndirectory = "dist/public/"\nbinding = "ASSETS"\nhtml_handling = "none"`,
			);
			// The user's compatibility_date is not touched.
			expect(written).toContain(`compatibility_date = "2025-01-01"`);
		} finally {
			await project.cleanup();
		}
	});

	test("never overrides a user-set html_handling; notices instead", async () => {
		const original = `name = "w"\nmain = "dist/server/worker.js"\ncompatibility_date = "2025-01-01"\ncompatibility_flags = ["nodejs_compat"]\n\n[assets]\ndirectory = "dist/public/"\nbinding = "ASSETS"\nhtml_handling = "auto-trailing-slash"\n`;
		const project = await tempProject({"wrangler.toml": original});
		try {
			const result = syncWranglerConfig({
				projectRoot: project.dir,
				desired: desired(),
				save: true,
			});
			expect(result.wrote).toBe(false);
			expect(await project.read("wrangler.toml")).toBe(original);
			expect(
				result.actions.some(
					(a) => a.kind === "notice" && a.description.includes("html_handling"),
				),
			).toBe(true);
		} finally {
			await project.cleanup();
		}
	});

	test("notices when compatibility_flags lacks nodejs_compat", async () => {
		const project = await tempProject({
			"wrangler.toml": `name = "w"\nmain = "dist/server/worker.js"\ncompatibility_date = "2025-01-01"\ncompatibility_flags = []\n\n[assets]\ndirectory = "dist/public/"\nbinding = "ASSETS"\nhtml_handling = "none"\n`,
		});
		try {
			const result = syncWranglerConfig({
				projectRoot: project.dir,
				desired: desired(),
				save: true,
			});
			expect(
				result.actions.some(
					(a) => a.kind === "notice" && a.description.includes("nodejs_compat"),
				),
			).toBe(true);
		} finally {
			await project.cleanup();
		}
	});

	test("bails to a notice on inline assets tables", async () => {
		const original = `name = "w"\nassets = {directory = "dist/public/"}\n`;
		const project = await tempProject({"wrangler.toml": original});
		try {
			const result = syncWranglerConfig({
				projectRoot: project.dir,
				desired: desired(),
				save: true,
			});
			expect(result.wrote).toBe(false);
			expect(await project.read("wrangler.toml")).toBe(original);
			expect(result.actions.some((a) => a.kind === "notice")).toBe(true);
		} finally {
			await project.cleanup();
		}
	});
});

describe("syncWranglerConfig: wrangler.json / wrangler.jsonc", () => {
	test("fills missing keys in wrangler.json", async () => {
		const project = await tempProject({
			"wrangler.json": JSON.stringify(
				{name: "w", vars: {FOO: "bar"}},
				null,
				"\t",
			),
		});
		try {
			const result = syncWranglerConfig({
				projectRoot: project.dir,
				desired: desired(),
				save: true,
			});
			expect(result.wrote).toBe(true);
			const written = JSON.parse(await project.read("wrangler.json"));
			expect(written.name).toBe("w");
			expect(written.vars).toEqual({FOO: "bar"});
			expect(written.main).toBe("dist/server/worker.js");
			expect(written.assets).toEqual({
				directory: "dist/public/",
				binding: "ASSETS",
				html_handling: "none",
			});
			// Indentation style is preserved.
			expect(await project.read("wrangler.json")).toContain("\n\t");
		} finally {
			await project.cleanup();
		}
	});

	test("does not rewrite a commented wrangler.jsonc; suggests instead", async () => {
		const original = `{\n\t// my worker\n\t"name": "w"\n}\n`;
		const project = await tempProject({"wrangler.jsonc": original});
		try {
			const result = syncWranglerConfig({
				projectRoot: project.dir,
				desired: desired(),
				save: true,
			});
			expect(result.wrote).toBe(false);
			expect(await project.read("wrangler.jsonc")).toBe(original);
			expect(result.actions.some((a) => a.kind === "add")).toBe(true);
			expect(
				result.actions.some(
					(a) => a.kind === "notice" && a.description.includes("comments"),
				),
			).toBe(true);
		} finally {
			await project.cleanup();
		}
	});

	test("jsonc takes precedence over toml, matching wrangler", async () => {
		const project = await tempProject({
			"wrangler.jsonc": `{"name": "w"}`,
			"wrangler.toml": `name = "other"\n`,
		});
		try {
			const result = syncWranglerConfig({
				projectRoot: project.dir,
				desired: desired(),
				save: false,
			});
			expect(result.path.endsWith("wrangler.jsonc")).toBe(true);
		} finally {
			await project.cleanup();
		}
	});

	test("a fully configured file yields no actions", async () => {
		const project = await tempProject({
			"wrangler.json": JSON.stringify({
				name: "w",
				main: "dist/server/worker.js",
				compatibility_date: "2025-01-01",
				compatibility_flags: ["nodejs_compat"],
				assets: {
					directory: "dist/public/",
					binding: "ASSETS",
					html_handling: "none",
				},
			}),
		});
		try {
			const result = syncWranglerConfig({
				projectRoot: project.dir,
				desired: desired(),
				save: true,
			});
			expect(result.wrote).toBe(false);
			expect(result.actions).toEqual([]);
		} finally {
			await project.cleanup();
		}
	});
});

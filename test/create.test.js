import {test, expect, describe, afterAll} from "bun:test";
import {spawnSync} from "child_process";
import {join} from "path";
import {mkdtempSync, readFileSync, existsSync, rmSync, copyFileSync} from "fs";
import {tmpdir} from "os";

/**
 * Tests for create-shovel CLI
 */

const CREATE_SCRIPT = join(import.meta.dirname, "../bin/create.ts");

function runCreate(projectName) {
	const result = spawnSync("bun", [CREATE_SCRIPT, projectName], {
		encoding: "utf8",
		timeout: 5000,
	});
	return {
		exitCode: result.status,
		stdout: result.stdout || "",
		stderr: result.stderr || "",
	};
}

/**
 * Generate a project in a temp directory and return helpers to inspect it.
 */
function generateProject({
	template,
	framework,
	typescript = true,
	platform = "node",
}) {
	const tempDir = mkdtempSync(join(tmpdir(), "shovel-create-test-"));
	const name = "test-app";
	const args = [
		CREATE_SCRIPT,
		name,
		"--template",
		template,
		"--framework",
		framework,
		"--platform",
		platform,
	];
	if (typescript) {
		args.push("--typescript");
	} else {
		args.push("--no-typescript");
	}
	const result = spawnSync("bun", args, {
		encoding: "utf8",
		timeout: 10000,
		cwd: tempDir,
	});
	const projectDir = join(tempDir, name);

	return {
		exitCode: result.status,
		stderr: result.stderr || "",
		projectDir,
		tempDir,
		readFile(relativePath) {
			return readFileSync(join(projectDir, relativePath), "utf8");
		},
		fileExists(relativePath) {
			return existsSync(join(projectDir, relativePath));
		},
		readJSON(relativePath) {
			return JSON.parse(readFileSync(join(projectDir, relativePath), "utf8"));
		},
		install() {
			const installResult = spawnSync("bun", ["install"], {
				encoding: "utf8",
				timeout: 30000,
				cwd: projectDir,
			});
			// TODO: Remove after publishing @b9g/platform with the
			// Window addEventListener overload fix in globals.d.ts
			const globalsDts = join(
				projectDir,
				"node_modules/@b9g/platform/src/globals.d.ts",
			);
			if (existsSync(globalsDts)) {
				copyFileSync(
					join(import.meta.dirname, "../packages/platform/src/globals.d.ts"),
					globalsDts,
				);
			}
			return {
				exitCode: installResult.status,
				stdout: installResult.stdout || "",
				stderr: installResult.stderr || "",
			};
		},
		typecheck() {
			const tscResult = spawnSync(
				join(projectDir, "node_modules", ".bin", "tsc"),
				["--noEmit"],
				{
					encoding: "utf8",
					timeout: 15000,
					cwd: projectDir,
				},
			);
			return {
				exitCode: tscResult.status,
				stdout: tscResult.stdout || "",
				stderr: tscResult.stderr || "",
			};
		},
		lint() {
			const lintResult = spawnSync(
				join(projectDir, "node_modules", ".bin", "eslint"),
				["src/"],
				{
					encoding: "utf8",
					timeout: 15000,
					cwd: projectDir,
				},
			);
			return {
				exitCode: lintResult.status,
				stdout: lintResult.stdout || "",
				stderr: lintResult.stderr || "",
			};
		},
	};
}

test("rejects project names with path traversal (..)", () => {
	const result = runCreate("../malicious");
	expect(result.exitCode).toBe(1);
	expect(result.stderr).toContain(
		"lowercase letters, numbers, and hyphens only",
	);
});

test("rejects project names with slashes", () => {
	const result = runCreate("foo/bar");
	expect(result.exitCode).toBe(1);
	expect(result.stderr).toContain(
		"lowercase letters, numbers, and hyphens only",
	);
});

test("rejects project names with uppercase", () => {
	const result = runCreate("MyProject");
	expect(result.exitCode).toBe(1);
	expect(result.stderr).toContain(
		"lowercase letters, numbers, and hyphens only",
	);
});

test("rejects project names with spaces", () => {
	const result = runCreate("my project");
	expect(result.exitCode).toBe(1);
	expect(result.stderr).toContain(
		"lowercase letters, numbers, and hyphens only",
	);
});

test("rejects project names with special characters", () => {
	const result = runCreate("my_project!");
	expect(result.exitCode).toBe(1);
	expect(result.stderr).toContain(
		"lowercase letters, numbers, and hyphens only",
	);
});

test("rejects absolute paths", () => {
	const result = runCreate("/tmp/malicious");
	expect(result.exitCode).toBe(1);
	expect(result.stderr).toContain(
		"lowercase letters, numbers, and hyphens only",
	);
});

// --- Scaffolding tests ---
// Verify generated project structure, dependencies, and content for each
// framework × template combination.

const SCAFFOLDING_COMBOS = [
	{template: "static-site", framework: "vanilla"},
	{template: "static-site", framework: "htmx"},
	{template: "static-site", framework: "alpine"},
	{template: "full-stack", framework: "vanilla"},
	{template: "full-stack", framework: "htmx"},
	{template: "full-stack", framework: "alpine"},
];

// Collect temp dirs for cleanup
const tempDirs = [];
afterAll(() => {
	for (const dir of tempDirs) {
		try {
			rmSync(dir, {recursive: true, force: true});
		} catch (_err) {
			// ignore cleanup errors
		}
	}
});

for (const {template, framework} of SCAFFOLDING_COMBOS) {
	describe(`${framework} ${template} (TypeScript)`, () => {
		const project = generateProject({template, framework, typescript: true});
		tempDirs.push(project.tempDir);

		test("generates successfully", () => {
			expect(project.exitCode).toBe(0);
		});

		test("creates server.ts and client.ts", () => {
			expect(project.fileExists("src/server.ts")).toBe(true);
			expect(project.fileExists("src/client.ts")).toBe(true);
			// Should NOT have app.ts (that's for hello-world/api)
			expect(project.fileExists("src/app.ts")).toBe(false);
		});

		test("package.json has correct entry point and dependencies", () => {
			const pkg = project.readJSON("package.json");
			expect(pkg.scripts.develop).toContain("src/server.ts");
			expect(pkg.scripts.build).toContain("src/server.ts");
			expect(pkg.dependencies["@b9g/assets"]).toBeDefined();
			expect(pkg.dependencies["@b9g/router"]).toBeDefined();
			expect(pkg.dependencies["@b9g/shovel"]).toBeDefined();

			if (framework === "htmx") {
				expect(pkg.dependencies["htmx.org"]).toBeDefined();
			}
			if (framework === "alpine") {
				expect(pkg.dependencies["alpinejs"]).toBeDefined();
			}
		});

		test("server.ts uses Router and assets middleware", () => {
			const server = project.readFile("src/server.ts");
			expect(server).toContain('import {Router} from "@b9g/router"');
			expect(server).toContain('import {assets} from "@b9g/assets/middleware"');
			expect(server).toContain("router.use(assets())");
			expect(server).toContain("router.handle(event.request)");
		});

		test("server.ts imports client bundle with assetBase", () => {
			const server = project.readFile("src/server.ts");
			expect(server).toContain("@ts-expect-error");
			expect(server).toContain('import clientUrl from "./client.ts"');
			expect(server).toContain('{assetBase: "/assets/"}');
		});

		test("server.ts includes bundled script tag, no CDN or inline scripts", () => {
			const server = project.readFile("src/server.ts");
			expect(server).toContain('<script src="${clientUrl}" type="module">');
			// No CDN links
			expect(server).not.toContain("unpkg.com");
			expect(server).not.toContain("cdn.jsdelivr.net");
			// No inline script blocks (the script tag with src is fine)
			expect(server).not.toMatch(/<script>[^<]/);
		});

		test("server.ts references src/server.ts in edit hint", () => {
			const server = project.readFile("src/server.ts");
			expect(server).toContain("src/server.ts");
		});

		if (framework === "htmx" || framework === "alpine") {
			test("generates env.d.ts for TypeScript", () => {
				expect(project.fileExists("src/env.d.ts")).toBe(true);
				const envDts = project.readFile("src/env.d.ts");
				if (framework === "htmx") {
					expect(envDts).toContain('declare module "htmx.org"');
				}
				if (framework === "alpine") {
					expect(envDts).toContain('declare module "alpinejs"');
					expect(envDts).toContain("start(): void");
				}
			});
		}

		if (framework === "vanilla") {
			test("does not generate env.d.ts", () => {
				expect(project.fileExists("src/env.d.ts")).toBe(false);
			});
		}

		test("generates tsconfig.json and eslint.config.js", () => {
			expect(project.fileExists("tsconfig.json")).toBe(true);
			expect(project.fileExists("eslint.config.js")).toBe(true);
		});

		test("package.json has lint script", () => {
			const pkg = project.readJSON("package.json");
			expect(pkg.scripts.lint).toBe("eslint src/");
		});

		test("generates README with multi-file project tree", () => {
			const readme = project.readFile("README.md");
			expect(readme).toContain("server.ts");
			expect(readme).toContain("client.ts");
			expect(readme).toContain("eslint.config.js");
			expect(readme).toContain("npm run lint");
		});

		test("installs dependencies, typechecks, and lints", () => {
			const install = project.install();
			expect(install.exitCode).toBe(0);

			const tsc = project.typecheck();
			expect(tsc.stdout).toBe("");
			expect(tsc.exitCode).toBe(0);

			const lint = project.lint();
			expect(lint.stdout).toBe("");
			expect(lint.exitCode).toBe(0);
		});
	});
}

// Test one JavaScript (non-TypeScript) variant to verify JS-specific behavior
describe("vanilla static-site (JavaScript)", () => {
	const project = generateProject({
		template: "static-site",
		framework: "vanilla",
		typescript: false,
	});
	tempDirs.push(project.tempDir);

	test("generates successfully", () => {
		expect(project.exitCode).toBe(0);
	});

	test("creates .js files instead of .ts", () => {
		expect(project.fileExists("src/server.js")).toBe(true);
		expect(project.fileExists("src/client.js")).toBe(true);
		expect(project.fileExists("src/server.ts")).toBe(false);
	});

	test("server.js has no TypeScript annotations", () => {
		const server = project.readFile("src/server.js");
		expect(server).not.toContain("@ts-expect-error");
		expect(server).not.toContain(": string");
	});

	test("does not generate tsconfig.json", () => {
		expect(project.fileExists("tsconfig.json")).toBe(false);
	});
});

// Test that htmx JS variant does NOT generate env.d.ts
describe("htmx full-stack (JavaScript)", () => {
	const project = generateProject({
		template: "full-stack",
		framework: "htmx",
		typescript: false,
	});
	tempDirs.push(project.tempDir);

	test("generates successfully", () => {
		expect(project.exitCode).toBe(0);
	});

	test("does not generate env.d.ts for JavaScript projects", () => {
		expect(project.fileExists("src/env.d.ts")).toBe(false);
	});
});

// Verify hello-world and api templates are unaffected
describe("hello-world template", () => {
	const project = generateProject({
		template: "hello-world",
		framework: "vanilla",
		typescript: true,
	});
	tempDirs.push(project.tempDir);

	test("still uses app.ts (no client bundle)", () => {
		expect(project.exitCode).toBe(0);
		expect(project.fileExists("src/app.ts")).toBe(true);
		expect(project.fileExists("src/server.ts")).toBe(false);
		expect(project.fileExists("src/client.ts")).toBe(false);
	});

	test("package.json does not include @b9g/assets", () => {
		const pkg = project.readJSON("package.json");
		expect(pkg.scripts.develop).toContain("src/app.ts");
		expect(pkg.dependencies["@b9g/assets"]).toBeUndefined();
	});
});

describe("api template", () => {
	const project = generateProject({
		template: "api",
		framework: "vanilla",
		typescript: true,
	});
	tempDirs.push(project.tempDir);

	test("still uses app.ts (no client bundle)", () => {
		expect(project.exitCode).toBe(0);
		expect(project.fileExists("src/app.ts")).toBe(true);
		expect(project.fileExists("src/server.ts")).toBe(false);
		expect(project.fileExists("src/client.ts")).toBe(false);
	});

	test("package.json does not include @b9g/assets", () => {
		const pkg = project.readJSON("package.json");
		expect(pkg.scripts.develop).toContain("src/app.ts");
		expect(pkg.dependencies["@b9g/assets"]).toBeUndefined();
	});
});

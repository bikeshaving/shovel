import {test, expect, describe, afterAll} from "bun:test";
import {spawnSync} from "child_process";
import {join} from "path";
import {mkdtempSync, readFileSync, existsSync, rmSync, copyFileSync} from "fs";
import {tmpdir} from "os";

/**
 * Tests for create-shovel CLI
 *
 * Every framework × template × typescript × jsx permutation is tested for:
 * - Correct project structure (entry files, config files)
 * - Correct dependencies and scripts in package.json
 * - Core Shovel patterns in generated code
 * - End-to-end: bun install + tsc --noEmit (TS) + eslint (if configured)
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

function generateProject({
	template,
	framework,
	typescript = true,
	jsx,
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
	if (jsx === true) {
		args.push("--jsx");
	} else if (jsx === false) {
		args.push("--no-jsx");
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

// --- Input validation tests ---

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
// Every framework × template × typescript × jsx permutation.

const ALL_COMBOS = [
	// Vanilla × Static-site
	{template: "static-site", framework: "vanilla", typescript: true},
	{template: "static-site", framework: "vanilla", typescript: false},
	// Vanilla × Full-stack
	{template: "full-stack", framework: "vanilla", typescript: true},
	{template: "full-stack", framework: "vanilla", typescript: false},
	// HTMX × Static-site
	{template: "static-site", framework: "htmx", typescript: true},
	{template: "static-site", framework: "htmx", typescript: false},
	// HTMX × Full-stack
	{template: "full-stack", framework: "htmx", typescript: true},
	{template: "full-stack", framework: "htmx", typescript: false},
	// Alpine × Static-site
	{template: "static-site", framework: "alpine", typescript: true},
	{template: "static-site", framework: "alpine", typescript: false},
	// Alpine × Full-stack
	{template: "full-stack", framework: "alpine", typescript: true},
	{template: "full-stack", framework: "alpine", typescript: false},
	// Crank × Static-site (4 variants: TS+JSX, TS, JS+JSX, JS)
	{template: "static-site", framework: "crank", typescript: true, jsx: true},
	{template: "static-site", framework: "crank", typescript: true, jsx: false},
	{template: "static-site", framework: "crank", typescript: false, jsx: true},
	{template: "static-site", framework: "crank", typescript: false, jsx: false},
	// Crank × Full-stack (4 variants)
	{template: "full-stack", framework: "crank", typescript: true, jsx: true},
	{template: "full-stack", framework: "crank", typescript: true, jsx: false},
	{template: "full-stack", framework: "crank", typescript: false, jsx: true},
	{template: "full-stack", framework: "crank", typescript: false, jsx: false},
	// Hello World
	{template: "hello-world", framework: "vanilla", typescript: true},
	{template: "hello-world", framework: "vanilla", typescript: false},
	// API
	{template: "api", framework: "vanilla", typescript: true},
	{template: "api", framework: "vanilla", typescript: false},
];

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

function comboLabel({template, framework, typescript, jsx}) {
	const lang = typescript ? (jsx ? "TSX" : "TS") : jsx ? "JSX" : "JS";
	return `${framework} ${template} (${lang})`;
}

function entryExt({typescript, jsx, framework}) {
	if (framework === "crank" && jsx) {
		return typescript ? "tsx" : "jsx";
	}
	return typescript ? "ts" : "js";
}

for (const combo of ALL_COMBOS) {
	const label = comboLabel(combo);
	const hasClientBundle =
		combo.template === "static-site" || combo.template === "full-stack";
	const ext = entryExt(combo);

	describe(label, () => {
		const project = generateProject(combo);
		tempDirs.push(project.tempDir);

		test("generates successfully", () => {
			expect(project.exitCode).toBe(0);
		});

		test("package.json has correct name and scripts", () => {
			const pkg = project.readJSON("package.json");
			expect(pkg.name).toBe("test-app");
			const entryFile = hasClientBundle
				? `src/server.${ext}`
				: `src/app.${ext}`;
			expect(pkg.scripts.develop).toContain(entryFile);
			expect(pkg.scripts.build).toContain(entryFile);
			expect(pkg.scripts.start).toBeDefined();
		});

		test("generates README", () => {
			expect(project.fileExists("README.md")).toBe(true);
			const readme = project.readFile("README.md");
			expect(readme).toContain("test-app");
		});

		if (hasClientBundle) {
			test("creates server and client entry files", () => {
				expect(project.fileExists(`src/server.${ext}`)).toBe(true);
				expect(project.fileExists(`src/client.${ext}`)).toBe(true);
			});

			test("package.json has asset pipeline dependencies", () => {
				const pkg = project.readJSON("package.json");
				expect(pkg.dependencies["@b9g/assets"]).toBeDefined();
				expect(pkg.dependencies["@b9g/router"]).toBeDefined();
				expect(pkg.dependencies["@b9g/shovel"]).toBeDefined();
			});

			test("package.json has framework-specific dependencies", () => {
				const pkg = project.readJSON("package.json");
				const deps = {...pkg.dependencies, ...pkg.devDependencies};
				if (combo.framework === "htmx") {
					expect(deps["htmx.org"]).toBeDefined();
				}
				if (combo.framework === "alpine") {
					expect(deps["alpinejs"]).toBeDefined();
				}
				if (combo.framework === "crank") {
					expect(deps["@b9g/crank"]).toBeDefined();
					expect(deps["eslint-plugin-crank"]).toBeDefined();
				}
			});

			test("server uses ServiceWorker fetch handler", () => {
				const server = project.readFile(`src/server.${ext}`);
				expect(server).toContain('addEventListener("fetch"');
				expect(server).toContain("event.respondWith");
			});

			test("server imports client bundle through asset pipeline", () => {
				const server = project.readFile(`src/server.${ext}`);
				expect(server).toContain(`from "./client.${ext}"`);
				expect(server).toContain("assetBase");
			});

			if (combo.template === "full-stack") {
				test("server has API route", () => {
					const server = project.readFile(`src/server.${ext}`);
					expect(server).toContain("/api/");
				});
			}

			test("client file imports the right framework", () => {
				const client = project.readFile(`src/client.${ext}`);
				expect(client.length).toBeGreaterThan(0);
				if (combo.framework === "htmx") {
					expect(client).toContain("htmx.org");
				}
				if (combo.framework === "alpine") {
					expect(client).toContain("alpinejs");
				}
				if (combo.framework === "crank") {
					expect(client).toContain("@b9g/crank");
				}
			});

			if (
				(combo.framework === "htmx" || combo.framework === "alpine") &&
				combo.typescript
			) {
				test("generates type declarations for framework", () => {
					expect(project.fileExists("src/env.d.ts")).toBe(true);
					const envDts = project.readFile("src/env.d.ts");
					if (combo.framework === "htmx") {
						expect(envDts).toContain('declare module "htmx.org"');
					}
					if (combo.framework === "alpine") {
						expect(envDts).toContain('declare module "alpinejs"');
					}
				});
			}
		} else {
			test("creates single app entry file", () => {
				expect(project.fileExists(`src/app.${ext}`)).toBe(true);
				expect(project.fileExists(`src/server.${ext}`)).toBe(false);
				expect(project.fileExists(`src/client.${ext}`)).toBe(false);
			});

			test("app uses ServiceWorker fetch handler", () => {
				const app = project.readFile(`src/app.${ext}`);
				expect(app).toContain('addEventListener("fetch"');
				expect(app).toContain("event.respondWith");
			});

			test("does not depend on asset pipeline", () => {
				const pkg = project.readJSON("package.json");
				expect(pkg.dependencies["@b9g/assets"]).toBeUndefined();
			});
		}

		if (combo.typescript) {
			test("has tsconfig.json with correct settings", () => {
				expect(project.fileExists("tsconfig.json")).toBe(true);
				const tsconfig = project.readJSON("tsconfig.json");
				expect(tsconfig.compilerOptions.strict).toBe(true);
				expect(tsconfig.compilerOptions.noEmit).toBe(true);
				expect(tsconfig.include).toContain("src/**/*");
			});
		} else {
			test("does not generate TypeScript config or syntax", () => {
				expect(project.fileExists("tsconfig.json")).toBe(false);
				const entryFile = hasClientBundle
					? `src/server.${ext}`
					: `src/app.${ext}`;
				const source = project.readFile(entryFile);
				expect(source).not.toContain("@ts-expect-error");
			});
		}

		// End-to-end: install, typecheck (TS), lint (if eslint configured)
		test(
			"end-to-end: install" +
				(combo.typescript ? " + typecheck" : "") +
				(hasClientBundle ? " + lint" : ""),
			() => {
				const install = project.install();
				expect(install.exitCode).toBe(0);

				if (combo.typescript) {
					const tsc = project.typecheck();
					expect(tsc.stdout).toBe("");
					expect(tsc.exitCode).toBe(0);
				}

				if (hasClientBundle) {
					const lint = project.lint();
					expect(lint.stdout).toBe("");
					expect(lint.exitCode).toBe(0);
				}
			},
			15000,
		);
	});
}

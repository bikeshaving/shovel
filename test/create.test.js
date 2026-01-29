import {test, expect} from "bun:test";
import {spawnSync} from "child_process";
import {join} from "path";

/**
 * Security tests for create-shovel CLI
 *
 * These tests verify that the CLI properly validates project names
 * to prevent path traversal attacks.
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

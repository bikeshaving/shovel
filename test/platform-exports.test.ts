/**
 * Tests that platform packages only import symbols that @b9g/platform/runtime
 * actually exports. Catches publish regressions like the missing
 * setBroadcastChannelBackend in @b9g/platform@0.1.18.
 */

import {describe, it, expect} from "bun:test";
import {readFileSync, existsSync} from "fs";
import {join} from "path";

const packagesDir = join(import.meta.dir, "..", "packages");

/** Extract named imports from `import { A, B } from "@b9g/platform/runtime"` */
function extractImportsFrom(
	code: string,
	fromModule: string,
): Set<string> {
	const imports = new Set<string>();
	// Match: import { A, B, C } from "module"
	// Handles multi-line imports
	const escaped = fromModule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const re = new RegExp(
		`import\\s*\\{([^}]+)\\}\\s*from\\s*["']${escaped}["']`,
		"g",
	);
	for (const match of code.matchAll(re)) {
		for (const name of match[1].split(",")) {
			const trimmed = name.trim();
			if (trimmed) {
				imports.add(trimmed);
			}
		}
	}
	return imports;
}

/** Extract the final `export { ... }` block from a bundled ESM file */
function extractExports(code: string): Set<string> {
	const exports = new Set<string>();
	// esbuild emits a single `export { ... }` block at the end
	const re = /export\s*\{([^}]+)\}/g;
	for (const match of code.matchAll(re)) {
		for (const name of match[1].split(",")) {
			// Handle `foo as bar` — the exported name is `bar`
			const parts = name.trim().split(/\s+as\s+/);
			const exported = (parts[1] || parts[0]).trim();
			if (exported) {
				exports.add(exported);
			}
		}
	}
	return exports;
}

describe("platform export compatibility", () => {
	const baseRuntimePath = join(
		packagesDir,
		"platform",
		"dist",
		"src",
		"runtime.js",
	);

	// Platform packages that have a runtime.js importing from @b9g/platform/runtime
	const platformPackages = ["platform-cloudflare"];

	it("@b9g/platform/runtime dist exists", () => {
		expect(existsSync(baseRuntimePath)).toBe(true);
	});

	for (const pkg of platformPackages) {
		const runtimePath = join(
			packagesDir,
			pkg,
			"dist",
			"src",
			"runtime.js",
		);

		it(`@b9g/${pkg}/runtime dist exists`, () => {
			expect(existsSync(runtimePath)).toBe(true);
		});

		it(`@b9g/${pkg}/runtime only imports symbols exported by @b9g/platform/runtime`, () => {
			const baseCode = readFileSync(baseRuntimePath, "utf-8");
			const pkgCode = readFileSync(runtimePath, "utf-8");

			const baseExports = extractExports(baseCode);
			const pkgImports = extractImportsFrom(
				pkgCode,
				"@b9g/platform/runtime",
			);

			expect(pkgImports.size).toBeGreaterThan(0);

			const missing = new Set<string>();
			for (const name of pkgImports) {
				if (!baseExports.has(name)) {
					missing.add(name);
				}
			}

			if (missing.size > 0) {
				throw new Error(
					`@b9g/${pkg}/runtime imports symbols not exported by @b9g/platform/runtime: ${[...missing].join(", ")}`,
				);
			}
		});
	}
});

/**
 * Tests for path syntax parser
 */

import {describe, it, expect} from "bun:test";
import {parsePath} from "../src/utils/path-syntax.js";

describe("parsePath", () => {
	const projectDir = "/home/user/project";
	const outDir = "/home/user/project/dist";

	describe("relative paths", () => {
		it("resolves ./ paths to projectDir", () => {
			const result = parsePath("./data/uploads", projectDir, outDir);
			expect(result.type).toBe("literal");
			expect(result.value).toBe("/home/user/project/data/uploads");
		});

		it("resolves ../ paths to projectDir parent", () => {
			const result = parsePath("../shared", projectDir, outDir);
			expect(result.type).toBe("literal");
			expect(result.value).toBe("/home/user/shared");
		});

		it("resolves bare names as relative to projectDir", () => {
			const result = parsePath("data", projectDir, outDir);
			expect(result.type).toBe("literal");
			expect(result.value).toBe("/home/user/project/data");
		});
	});

	describe("absolute paths", () => {
		it("returns absolute paths as-is", () => {
			const result = parsePath("/mnt/data/uploads", projectDir, outDir);
			expect(result.type).toBe("literal");
			expect(result.value).toBe("/mnt/data/uploads");
		});
	});

	describe("__outdir__ paths", () => {
		it("resolves __outdir__ to outDir", () => {
			const result = parsePath("__outdir__", projectDir, outDir);
			expect(result.type).toBe("literal");
			expect(result.value).toBe("/home/user/project/dist");
		});

		it("resolves __outdir__/suffix to outDir + suffix", () => {
			const result = parsePath("__outdir__/server", projectDir, outDir);
			expect(result.type).toBe("literal");
			expect(result.value).toBe("/home/user/project/dist/server");
		});

		it("handles nested __outdir__ paths", () => {
			const result = parsePath("__outdir__/assets/public", projectDir, outDir);
			expect(result.type).toBe("literal");
			expect(result.value).toBe("/home/user/project/dist/assets/public");
		});
	});

	describe("__tmpdir__ paths", () => {
		it("returns runtime expression for __tmpdir__", () => {
			const result = parsePath("__tmpdir__", projectDir, outDir);
			expect(result.type).toBe("runtime");
			expect(result.expression).toBe("__os__.tmpdir()");
			expect(result.imports).toEqual(["node:os"]);
		});

		it("returns runtime expression for __tmpdir__/suffix", () => {
			const result = parsePath("__tmpdir__/cache", projectDir, outDir);
			expect(result.type).toBe("runtime");
			expect(result.expression).toBe('__os__.tmpdir() + "/cache"');
			expect(result.imports).toEqual(["node:os"]);
		});
	});

	describe("$ENVVAR paths", () => {
		it("returns runtime expression for $ENVVAR", () => {
			const result = parsePath("$DATADIR", projectDir, outDir);
			expect(result.type).toBe("runtime");
			expect(result.expression).toBe("process.env.DATADIR");
		});

		it("returns runtime expression for $ENVVAR/suffix", () => {
			const result = parsePath("$DATADIR/uploads", projectDir, outDir);
			expect(result.type).toBe("runtime");
			expect(result.expression).toBe('process.env.DATADIR + "/uploads"');
		});

		it("handles complex env var names", () => {
			const result = parsePath("$MY_APP_DATA_DIR/files", projectDir, outDir);
			expect(result.type).toBe("runtime");
			expect(result.expression).toBe('process.env.MY_APP_DATA_DIR + "/files"');
		});
	});

	describe("edge cases", () => {
		it("handles deeply nested relative paths", () => {
			const result = parsePath("./a/b/c/d", projectDir, outDir);
			expect(result.type).toBe("literal");
			expect(result.value).toBe("/home/user/project/a/b/c/d");
		});

		it("handles multiple $ENVVAR patterns correctly", () => {
			// Only the first $ENVVAR should be treated as env var
			// The rest is the path suffix
			const result = parsePath("$DATADIR/sub/$OTHER", projectDir, outDir);
			expect(result.type).toBe("runtime");
			expect(result.expression).toBe('process.env.DATADIR + "/sub/$OTHER"');
		});
	});
});

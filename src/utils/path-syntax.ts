/**
 * Path-specific syntax parser for directory configuration.
 *
 * Syntax:
 * - `./path` or `../path` - Relative to projectDir, resolved at build time
 * - `/path` - Absolute path, used as-is
 * - `$ENVVAR` - Environment variable, resolved at runtime
 * - `$ENVVAR/suffix` - Env var with path suffix, resolved at runtime
 * - `__outdir__` or `__outdir__/path` - Build output directory, resolved at build time
 * - `__tmpdir__` - OS temp directory, resolved at runtime
 */

import * as path from "node:path";

export interface ParsedPath {
	/**
	 * 'literal' - Path is fully resolved at build time
	 * 'runtime' - Path requires runtime evaluation
	 */
	type: "literal" | "runtime";
	/**
	 * For literal: the resolved absolute path
	 * For runtime: not used (see expression)
	 */
	value: string;
	/**
	 * For runtime: JavaScript expression that evaluates to the path
	 */
	expression?: string;
	/**
	 * For runtime: required imports (e.g., ["node:os"] for tmpdir)
	 */
	imports?: string[];
}

// Match $IDENTIFIER at start, capture the rest as suffix
const ENV_VAR_PATTERN = /^\$([A-Z][A-Z0-9_]*)(\/.*)?$/;

/**
 * Parse a path configuration value into a resolved path or runtime expression.
 *
 * @param value - The path value from config
 * @param projectDir - Absolute path to the project directory (where shovel.json lives)
 * @param outDir - Absolute path to the build output directory
 * @returns Parsed path with type and value/expression
 */
export function parsePath(
	value: string,
	projectDir: string,
	outDir: string,
): ParsedPath {
	// Handle __tmpdir__ - runtime resolution
	if (value === "__tmpdir__") {
		return {
			type: "runtime",
			value: "",
			expression: "__os__.tmpdir()",
			imports: ["node:os"],
		};
	}

	// Handle __tmpdir__/suffix - runtime resolution with suffix
	if (value.startsWith("__tmpdir__/")) {
		const suffix = value.slice("__tmpdir__".length);
		return {
			type: "runtime",
			value: "",
			expression: `__os__.tmpdir() + ${JSON.stringify(suffix)}`,
			imports: ["node:os"],
		};
	}

	// Handle __outdir__ - build time resolution
	if (value === "__outdir__") {
		return {
			type: "literal",
			value: outDir,
		};
	}

	// Handle __outdir__/suffix - build time resolution
	if (value.startsWith("__outdir__/")) {
		const suffix = value.slice("__outdir__".length);
		return {
			type: "literal",
			value: path.join(outDir, suffix),
		};
	}

	// Handle $ENVVAR and $ENVVAR/suffix - runtime resolution
	const envMatch = value.match(ENV_VAR_PATTERN);
	if (envMatch) {
		const [, envVar, suffix] = envMatch;
		if (suffix) {
			return {
				type: "runtime",
				value: "",
				expression: `process.env.${envVar} + ${JSON.stringify(suffix)}`,
			};
		}
		return {
			type: "runtime",
			value: "",
			expression: `process.env.${envVar}`,
		};
	}

	// Handle relative paths - build time resolution
	if (value.startsWith("./") || value.startsWith("../")) {
		return {
			type: "literal",
			value: path.resolve(projectDir, value),
		};
	}

	// Handle absolute paths - use as-is
	if (path.isAbsolute(value)) {
		return {
			type: "literal",
			value: value,
		};
	}

	// Fallback: treat as relative to projectDir
	// This handles bare names like "data" -> "./data"
	return {
		type: "literal",
		value: path.resolve(projectDir, value),
	};
}

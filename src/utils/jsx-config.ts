/**
 * JSX configuration utilities for esbuild
 *
 * Reads JSX settings from tsconfig.json and provides defaults for @b9g/crank.
 * Respects inline JSX pragma comments (e.g., @jsx h, @jsxFrag Fragment).
 */

import {readFile} from "fs/promises";
import {join, dirname} from "path";
import {existsSync} from "fs";
import type {BuildOptions} from "esbuild";

/**
 * JSX options for esbuild
 */
export interface JSXOptions {
	jsx?: "transform" | "preserve" | "automatic";
	jsxFactory?: string;
	jsxFragment?: string;
	jsxImportSource?: string;
	jsxSideEffects?: boolean;
}

/**
 * Default JSX settings for @b9g/crank (using automatic runtime)
 */
const CRANK_JSX_DEFAULTS: JSXOptions = {
	jsx: "automatic",
	jsxImportSource: "@b9g/crank",
};

/**
 * Find tsconfig.json by walking up from the given directory
 */
async function findTsConfig(startDir: string): Promise<string | null> {
	let dir = startDir;
	while (dir !== dirname(dir)) {
		const tsconfigPath = join(dir, "tsconfig.json");
		if (existsSync(tsconfigPath)) {
			return tsconfigPath;
		}
		dir = dirname(dir);
	}
	return null;
}

/**
 * Parse tsconfig.json with basic extends support
 */
async function parseTsConfig(
	tsconfigPath: string,
): Promise<Record<string, any>> {
	const content = await readFile(tsconfigPath, "utf8");

	// Strip comments (single-line // and multi-line /* */)
	const stripped = content
		.replace(/\/\/.*$/gm, "")
		.replace(/\/\*[\s\S]*?\*\//g, "");

	const config = JSON.parse(stripped);

	// Handle extends
	if (config.extends) {
		const baseDir = dirname(tsconfigPath);
		let extendsPath = config.extends;

		// Resolve the extends path
		if (extendsPath.startsWith(".")) {
			extendsPath = join(baseDir, extendsPath);
		} else {
			// Try to resolve from node_modules
			extendsPath = join(baseDir, "node_modules", extendsPath);
		}

		// Add .json extension if missing
		if (!extendsPath.endsWith(".json")) {
			extendsPath += ".json";
		}

		if (existsSync(extendsPath)) {
			const baseConfig = await parseTsConfig(extendsPath);
			// Merge base config with current (current takes precedence)
			return {
				...baseConfig,
				...config,
				compilerOptions: {
					...baseConfig.compilerOptions,
					...config.compilerOptions,
				},
			};
		}
	}

	return config;
}

/**
 * Map TypeScript JSX settings to esbuild options
 */
function mapTsConfigToEsbuild(
	compilerOptions: Record<string, any>,
): JSXOptions {
	const options: JSXOptions = {};

	// Map jsx option
	if (compilerOptions.jsx) {
		switch (compilerOptions.jsx) {
			case "react":
			case "react-native":
				options.jsx = "transform";
				break;
			case "react-jsx":
			case "react-jsxdev":
				options.jsx = "automatic";
				break;
			case "preserve":
				options.jsx = "preserve";
				break;
		}
	}

	// Map jsxFactory (TypeScript calls it jsxFactory too)
	if (compilerOptions.jsxFactory) {
		options.jsxFactory = compilerOptions.jsxFactory;
	}

	// Map jsxFragmentFactory → jsxFragment
	if (compilerOptions.jsxFragmentFactory) {
		options.jsxFragment = compilerOptions.jsxFragmentFactory;
	}

	// Map jsxImportSource
	if (compilerOptions.jsxImportSource) {
		options.jsxImportSource = compilerOptions.jsxImportSource;
	}

	return options;
}

/**
 * Load JSX configuration for a project
 *
 * Priority:
 * 1. tsconfig.json settings (if present)
 * 2. @b9g/crank defaults
 *
 * Note: Inline pragma comments (@jsx, @jsxFrag) are automatically
 * respected by esbuild and override these settings per-file.
 *
 * @param projectRoot - The project root directory to search for tsconfig.json
 * @returns JSX options for esbuild
 */
export async function loadJSXConfig(projectRoot: string): Promise<JSXOptions> {
	// Try to find and parse tsconfig.json
	const tsconfigPath = await findTsConfig(projectRoot);

	if (tsconfigPath) {
		const config = await parseTsConfig(tsconfigPath);
		const compilerOptions = config.compilerOptions || {};

		// Check if any JSX options are specified
		const hasJsxConfig =
			compilerOptions.jsx ||
			compilerOptions.jsxFactory ||
			compilerOptions.jsxFragmentFactory ||
			compilerOptions.jsxImportSource;

		if (hasJsxConfig) {
			const tsOptions = mapTsConfigToEsbuild(compilerOptions);
			// Merge with defaults (tsconfig takes precedence)
			return {
				...CRANK_JSX_DEFAULTS,
				...tsOptions,
			};
		}
	}

	// Return Crank defaults
	return {...CRANK_JSX_DEFAULTS};
}

/**
 * Apply JSX options to an esbuild build configuration
 *
 * @param buildOptions - The esbuild build options to modify
 * @param jsxOptions - The JSX options to apply
 */
export function applyJSXOptions(
	buildOptions: BuildOptions,
	jsxOptions: JSXOptions,
): void {
	if (jsxOptions.jsx) {
		buildOptions.jsx = jsxOptions.jsx;
	}
	if (jsxOptions.jsxFactory) {
		buildOptions.jsxFactory = jsxOptions.jsxFactory;
	}
	if (jsxOptions.jsxFragment) {
		buildOptions.jsxFragment = jsxOptions.jsxFragment;
	}
	if (jsxOptions.jsxImportSource) {
		buildOptions.jsxImportSource = jsxOptions.jsxImportSource;
	}
	if (jsxOptions.jsxSideEffects !== undefined) {
		buildOptions.jsxSideEffects = jsxOptions.jsxSideEffects;
	}
}

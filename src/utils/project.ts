/**
 * Project root utilities
 *
 * Provides consistent functions for finding project directories
 * and resolving node_modules paths.
 */

import {existsSync, readFileSync} from "fs";
import {dirname, join} from "path";

/**
 * Find the project root by looking for the nearest package.json.
 * Starts from cwd and walks up the directory tree.
 *
 * @param startDir - Directory to start searching from (defaults to cwd)
 * @returns The directory containing package.json, or startDir if not found
 */
// eslint-disable-next-line no-restricted-properties -- This is the canonical entry point for cwd
export function findProjectRoot(startDir: string = process.cwd()): string {
	let dir = startDir;
	while (dir !== dirname(dir)) {
		if (existsSync(join(dir, "package.json"))) {
			return dir;
		}
		dir = dirname(dir);
	}
	return startDir;
}

/**
 * Find the workspace root by looking for a package.json with a "workspaces" field.
 * Used for monorepo detection.
 *
 * @param startDir - Directory to start searching from (defaults to cwd)
 * @returns The workspace root directory, or null if not in a workspace
 */
export function findWorkspaceRoot(
	// eslint-disable-next-line no-restricted-properties -- Canonical entry point for cwd
	startDir: string = process.cwd(),
): string | null {
	let dir = startDir;
	while (dir !== dirname(dir)) {
		const packageJsonPath = join(dir, "package.json");
		if (existsSync(packageJsonPath)) {
			try {
				const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
				if (packageJson.workspaces) {
					return dir;
				}
			} catch {
				// Ignore parse errors, continue searching
			}
		}
		dir = dirname(dir);
	}
	return null;
}

/**
 * Get the path to node_modules for the current project.
 *
 * @param startDir - Directory to start searching from (defaults to cwd)
 * @returns Path to node_modules directory
 */
export function getNodeModulesPath(startDir?: string): string {
	return join(findProjectRoot(startDir), "node_modules");
}

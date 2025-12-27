/* eslint-disable no-restricted-properties -- Test utilities need process.cwd */
/**
 * Shared test utilities
 *
 * Provides helpers for copying fixtures to temp directories with proper
 * node_modules setup for test isolation.
 */

import * as FS from "fs/promises";
import {join, resolve} from "path";
import {tmpdir} from "os";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["test", "utils"]);

export const FIXTURES_DIR = resolve(import.meta.dir, "fixtures");

/**
 * Copy a fixture directory to a temp directory with node_modules symlink.
 * Returns the temp directory path and a cleanup function.
 */
export async function copyFixtureToTemp(fixtureName, prefix = "shovel-test-") {
	const fixtureDir = join(FIXTURES_DIR, fixtureName);
	const tempDir = join(
		tmpdir(),
		`${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);

	// Copy fixture to temp dir
	await copyDir(fixtureDir, tempDir);

	// Symlink node_modules from workspace root
	const nodeModulesSource = join(process.cwd(), "node_modules");
	const nodeModulesLink = join(tempDir, "node_modules");
	await FS.symlink(nodeModulesSource, nodeModulesLink, "dir");

	return {
		dir: tempDir,
		src: join(tempDir, "src"),
		dist: join(tempDir, "dist"),
		async cleanup() {
			try {
				await FS.rm(tempDir, {recursive: true, force: true});
			} catch (err) {
				logger.debug`Cleanup of ${tempDir} failed (may already be removed): ${err}`;
			}
		},
	};
}

/**
 * Recursively copy a directory
 */
async function copyDir(src, dest) {
	await FS.mkdir(dest, {recursive: true});
	const entries = await FS.readdir(src, {withFileTypes: true});

	for (const entry of entries) {
		const srcPath = join(src, entry.name);
		const destPath = join(dest, entry.name);

		if (entry.isDirectory()) {
			await copyDir(srcPath, destPath);
		} else {
			await FS.copyFile(srcPath, destPath);
		}
	}
}

/**
 * Check if a file exists
 */
export async function fileExists(path) {
	try {
		await FS.access(path);
		return true;
	} catch (err) {
		// ENOENT means file doesn't exist, other errors are unexpected
		if (err.code !== "ENOENT") {
			logger.warn`Unexpected error checking file ${path}: ${err}`;
		}
		return false;
	}
}

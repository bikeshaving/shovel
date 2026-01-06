/**
 * Git utilities for build-time information
 */

import {execSync} from "child_process";

/**
 * Get git commit SHA for the current repository.
 * Returns empty string if not in a git repository or git is not available.
 */
export function getGitSHA(cwd?: string): string {
	try {
		return execSync("git rev-parse HEAD", {
			encoding: "utf8",
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch (_err) {
		// Not a git repo or git not available - return empty string
		return "";
	}
}

/**
 * Shovel data directory paths
 *
 * Uses XDG Base Directory Specification when available, with sensible defaults.
 * On macOS/Linux without XDG_DATA_HOME set, defaults to ~/.local/share/shovel
 */

import {homedir} from "os";
import {join} from "path";

/**
 * Get the base data directory for shovel.
 * Respects XDG_DATA_HOME if set, otherwise uses ~/.local/share
 */
function getDataHome(): string {
	return process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
}

/**
 * Shovel data directory
 * Default: ~/.local/share/shovel
 */
export const SHOVEL_DIR = join(getDataHome(), "shovel");

/**
 * Certificate storage directory
 * Default: ~/.local/share/shovel/certs
 */
export const CERTS_DIR = join(SHOVEL_DIR, "certs");

/**
 * VirtualHost IPC socket path
 * Default: ~/.local/share/shovel/virtualhost.sock
 */
export const VIRTUALHOST_SOCKET_PATH = join(SHOVEL_DIR, "virtualhost.sock");

/**
 * Legacy shovel directory (~/.shovel)
 * Used for migration from old location
 */
export const LEGACY_SHOVEL_DIR = join(homedir(), ".shovel");

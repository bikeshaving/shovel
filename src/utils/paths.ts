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
	// eslint-disable-next-line no-restricted-properties
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
 * Get VirtualHost IPC socket path for a specific port.
 * Each port gets its own socket to avoid conflicts.
 * Default: ~/.local/share/shovel/virtualhost-{port}.sock
 */
export function getVirtualHostSocketPath(port: number): string {
	return join(SHOVEL_DIR, `virtualhost-${port}.sock`);
}

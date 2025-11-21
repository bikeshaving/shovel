/**
 * Centralized default values for Shovel CLI
 * These are the defaults for CLI options - no environment variables
 */

import {cpus} from "os";

/**
 * Default configuration constants
 * Used as CLI option defaults and internal constants
 */
export const DEFAULTS = {
	SERVER: {
		PORT: 7777,
		HOST: "localhost",
	},
	CACHE: {
		MAX_ENTRIES: 1000,
		TTL: 300000, // 5 minutes
	},
	WORKERS: cpus().length,
} as const;

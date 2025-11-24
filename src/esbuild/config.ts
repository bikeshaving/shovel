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
	WORKERS: 1, // Single worker for development - user can override with --workers flag
} as const;

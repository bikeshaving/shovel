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
		TIMEOUT: 5000,
	},
	CACHE: {
		MAX_ENTRIES: 1000,
		MAX_SIZE: 50 * 1024 * 1024, // 50MB
		TTL: 300000, // 5 minutes
		HEADERS: {
			ASSETS: "public, max-age=31536000", // 1 year
			PAGES: "public, max-age=300", // 5 minutes  
			API: "public, max-age=180", // 3 minutes
			ABOUT: "public, max-age=3600", // 1 hour
		},
	},
	PATHS: {
		OUTPUT_DIR: "dist",
		ASSETS_DIR: "assets",
		MANIFEST_FILE: "manifest.json",
	},
	WORKERS: {
		DEVELOPMENT: 2,
		PRODUCTION: cpus().length,
	},
} as const;

/**
 * Get default worker count based on environment
 */
export function getDefaultWorkerCount(): number {
	const isProduction = process.env.NODE_ENV === "production";
	return isProduction ? DEFAULTS.WORKERS.PRODUCTION : DEFAULTS.WORKERS.DEVELOPMENT;
}
/**
 * Generate esbuild define options for environment variables
 * Follows Vite conventions: https://vite.dev/guide/env-and-mode
 */

export interface EnvDefines {
	[key: string]: string;
}

/**
 * Create environment variable definitions for esbuild
 * Injects both Vite-style import.meta.env and legacy process.env.NODE_ENV
 */
export function createEnvDefines(mode: "development" | "production"): EnvDefines {
	const isDev = mode === "development";
	const isProd = mode === "production";

	return {
		// Vite conventions - import.meta.env
		"import.meta.env.MODE": JSON.stringify(mode),
		"import.meta.env.DEV": JSON.stringify(isDev),
		"import.meta.env.PROD": JSON.stringify(isProd),
		"import.meta.env.SSR": JSON.stringify(true), // Shovel is always SSR
		"import.meta.env.BASE_URL": JSON.stringify("/"),

		// Node.js ecosystem compatibility
		"process.env.NODE_ENV": JSON.stringify(mode),
	};
}

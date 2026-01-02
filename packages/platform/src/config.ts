/**
 * Platform Config Expression Helpers
 *
 * Helper functions for config expressions that delegate to the current Platform.
 * Generated config modules import these functions.
 */

// Declare __SHOVEL_OUTDIR__ for TypeScript (injected by esbuild at build time)
declare const __SHOVEL_OUTDIR__: string | undefined;

// ============================================================================
// Config Expression Provider Interface
// ============================================================================

/**
 * Minimal interface for config expression methods.
 * Platform implements this, but lightweight runtime classes can also implement
 * just these methods without the full Platform interface.
 */
export interface ConfigExpressionProvider {
	env(name: string): string | undefined;
	outdir(): string;
	tmpdir(): string;
	joinPath(...segments: (string | undefined)[]): string;
}

/**
 * Default implementation of ConfigExpressionProvider using process.env.
 * Works on Node.js, Bun, Deno, and Cloudflare Workers (with nodejs_compat).
 */
export class DefaultConfigProvider implements ConfigExpressionProvider {
	env(name: string): string | undefined {
		return process.env[name];
	}

	outdir(): string {
		const fromEnv = process.env.SHOVEL_OUTDIR;
		if (fromEnv) return fromEnv;
		if (typeof __SHOVEL_OUTDIR__ !== "undefined" && __SHOVEL_OUTDIR__) {
			return __SHOVEL_OUTDIR__;
		}
		return ".";
	}

	tmpdir(): string {
		return "/tmp";
	}

	joinPath(...segments: (string | undefined)[]): string {
		for (let i = 0; i < segments.length; i++) {
			if (segments[i] === undefined) {
				throw new Error(
					`joinPath: segment ${i} is undefined (missing env var?)`,
				);
			}
		}
		const joined = (segments as string[]).filter(Boolean).join("/");
		return joined.replace(/([^:])\/+/g, "$1/");
	}
}

// ============================================================================
// Global Platform Instance
// ============================================================================

let _currentPlatform: ConfigExpressionProvider | null = null;

/**
 * Set the current platform for config expressions
 * Called during runtime initialization
 */
export function setCurrentPlatform(platform: ConfigExpressionProvider): void {
	_currentPlatform = platform;
}

/**
 * Get the current platform
 */
export function getCurrentPlatform(): ConfigExpressionProvider | null {
	return _currentPlatform;
}

// ============================================================================
// Config Expression Helper Functions
// These are called by generated config modules
// ============================================================================

/**
 * Get environment variable
 * Delegates to current platform if registered, otherwise uses process.env
 */
export function env(name: string): string | undefined {
	if (_currentPlatform) {
		return _currentPlatform.env(name);
	}
	return process.env[name];
}

/**
 * Get output directory
 * Delegates to current platform if registered, otherwise uses fallbacks
 */
export function outdir(): string {
	if (_currentPlatform) {
		return _currentPlatform.outdir();
	}
	const fromEnv = process.env.SHOVEL_OUTDIR;
	if (fromEnv) return fromEnv;
	if (typeof __SHOVEL_OUTDIR__ !== "undefined" && __SHOVEL_OUTDIR__) {
		return __SHOVEL_OUTDIR__;
	}
	return ".";
}

/**
 * Get temp directory
 * Delegates to current platform if registered, otherwise returns /tmp
 */
export function tmpdir(): string {
	if (_currentPlatform) {
		return _currentPlatform.tmpdir();
	}
	return "/tmp";
}

/**
 * Join path segments
 * Delegates to current platform if registered, otherwise uses simple join
 */
export function joinPath(...segments: (string | undefined)[]): string {
	if (_currentPlatform) {
		return _currentPlatform.joinPath(...segments);
	}
	for (let i = 0; i < segments.length; i++) {
		if (segments[i] === undefined) {
			throw new Error(
				`joinPath: segment ${i} is undefined (missing env var?)`,
			);
		}
	}
	const joined = (segments as string[]).filter(Boolean).join("/");
	return joined.replace(/([^:])\/+/g, "$1/");
}

// ============================================================================
// Config Validation
// ============================================================================

/**
 * Error thrown when config validation fails
 */
export class ConfigValidationError extends Error {
	constructor(
		public readonly path: string,
		public readonly issue: "undefined" | "NaN",
	) {
		const message =
			issue === "undefined"
				? `Config "${path}" is undefined. Ensure required environment variables are set.`
				: `Config "${path}" is NaN. Ensure the environment variable contains a valid number.`;
		super(message);
		this.name = "ConfigValidationError";
	}
}

/**
 * Validate that a config object has no undefined or NaN values.
 * Call this at config module load time to fail fast on missing env vars.
 *
 * @param config - The config object to validate
 * @param path - Current path for error messages (used in recursion)
 * @throws ConfigValidationError if any value is undefined or NaN
 */
export function validateConfig(
	config: Record<string, unknown>,
	path: string = "",
): void {
	for (const [key, value] of Object.entries(config)) {
		const fullPath = path ? `${path}.${key}` : key;

		if (value === undefined) {
			throw new ConfigValidationError(fullPath, "undefined");
		}

		if (typeof value === "number" && Number.isNaN(value)) {
			throw new ConfigValidationError(fullPath, "NaN");
		}

		// Recurse into nested objects (but not arrays or null)
		if (value !== null && typeof value === "object" && !Array.isArray(value)) {
			validateConfig(value as Record<string, unknown>, fullPath);
		}
	}
}

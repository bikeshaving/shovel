/**
 * Config Validation Utilities
 *
 * Helpers for validating config objects at runtime.
 */

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
 * Call this at runtime to fail fast on missing env vars.
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

/**
 * Utility functions for platform implementations
 */

import type {CacheBackendConfig} from "./base-platform.js";

/**
 * Parse TTL string to milliseconds
 */
export function parseTTL(ttl: string | number | undefined): number | undefined {
	if (typeof ttl === "number") {
		return ttl;
	}

	if (typeof ttl !== "string") {
		return undefined;
	}

	const match = ttl.match(/^(\d+)\s*(ms|s|m|h|d)?$/);
	if (!match) {
		throw new Error(
			`Invalid TTL format: ${ttl}. Use format like '5m', '1h', '30s'`,
		);
	}

	const value = parseInt(match[1], 10);
	const unit = match[2] || "ms";

	const multipliers = {
		ms: 1,
		s: 1000,
		m: 60 * 1000,
		h: 60 * 60 * 1000,
		d: 24 * 60 * 60 * 1000,
	};

	return value * multipliers[unit as keyof typeof multipliers];
}

/**
 * Merge cache configurations with defaults
 */
export function mergeCacheConfig(
	userConfig: CacheBackendConfig | undefined,
	defaults: Partial<CacheBackendConfig>,
): CacheBackendConfig {
	return {
		type: "memory",
		...defaults,
		...userConfig,
	};
}

/**
 * Validate cache backend configuration
 */
export function validateCacheConfig(config: CacheBackendConfig): void {
	const validTypes = ["memory", "filesystem", "redis", "kv", "custom"];

	if (!validTypes.includes(config.type)) {
		throw new Error(
			`Invalid cache type '${config.type}'. Must be one of: ${validTypes.join(", ")}`,
		);
	}

	if (config.type === "filesystem" && !config.dir) {
		throw new Error("Filesystem cache requires a directory (dir) option");
	}

	if (config.type === "redis" && !config.url) {
		throw new Error("Redis cache requires a connection URL (url) option");
	}

	if (config.type === "custom" && !config.factory) {
		throw new Error("Custom cache requires a factory function");
	}

	if (config.maxEntries !== undefined && config.maxEntries <= 0) {
		throw new Error("maxEntries must be a positive number");
	}

	if (config.ttl !== undefined) {
		try {
			parseTTL(config.ttl);
		} catch (error) {
			throw new Error(`Invalid TTL configuration: ${error.message}`);
		}
	}
}

/**
 * Create CORS headers from configuration
 */
export function createCorsHeaders(
	corsConfig: any, // CorsConfig but avoiding circular import
	request: Request,
): Headers {
	const headers = new Headers();

	if (!corsConfig) {
		return headers;
	}

	const origin = request.headers.get("origin");

	// Handle origin
	if (corsConfig.origin === true) {
		headers.set("Access-Control-Allow-Origin", "*");
	} else if (typeof corsConfig.origin === "string") {
		headers.set("Access-Control-Allow-Origin", corsConfig.origin);
	} else if (Array.isArray(corsConfig.origin)) {
		if (origin && corsConfig.origin.includes(origin)) {
			headers.set("Access-Control-Allow-Origin", origin);
		}
	} else if (corsConfig.origin instanceof RegExp) {
		if (origin && corsConfig.origin.test(origin)) {
			headers.set("Access-Control-Allow-Origin", origin);
		}
	} else if (typeof corsConfig.origin === "function") {
		if (origin && corsConfig.origin(origin)) {
			headers.set("Access-Control-Allow-Origin", origin);
		}
	}

	// Handle methods
	if (corsConfig.methods) {
		headers.set("Access-Control-Allow-Methods", corsConfig.methods.join(", "));
	}

	// Handle headers
	if (corsConfig.allowedHeaders) {
		headers.set(
			"Access-Control-Allow-Headers",
			corsConfig.allowedHeaders.join(", "),
		);
	}

	if (corsConfig.exposedHeaders) {
		headers.set(
			"Access-Control-Expose-Headers",
			corsConfig.exposedHeaders.join(", "),
		);
	}

	// Handle credentials
	if (corsConfig.credentials) {
		headers.set("Access-Control-Allow-Credentials", "true");
	}

	// Handle max age
	if (corsConfig.maxAge !== undefined) {
		headers.set("Access-Control-Max-Age", corsConfig.maxAge.toString());
	}

	return headers;
}

/**
 * Merge headers from multiple sources
 */
export function mergeHeaders(
	...headerSources: (Headers | Record<string, string> | undefined)[]
): Headers {
	const result = new Headers();

	for (const source of headerSources) {
		if (!source) continue;

		if (source instanceof Headers) {
			for (const [key, value] of source.entries()) {
				result.set(key, value);
			}
		} else {
			for (const [key, value] of Object.entries(source)) {
				result.set(key, value);
			}
		}
	}

	return result;
}

/**
 * Check if request is a preflight CORS request
 */
export function isPreflightRequest(request: Request): boolean {
	return (
		request.method === "OPTIONS" &&
		request.headers.has("access-control-request-method")
	);
}

/**
 * Create a preflight response
 */
export function createPreflightResponse(
	corsConfig: any,
	request: Request,
): Response {
	const headers = createCorsHeaders(corsConfig, request);
	return new Response(null, {status: 204, headers});
}

/**
 * Standard middleware utilities for HTTP routing
 */

import type {FunctionMiddleware} from "./index.js";

// ============================================================================
// TRAILING SLASH
// ============================================================================

/**
 * Mode for trailing slash normalization
 */
export type TrailingSlashMode = "strip" | "add";

/**
 * Middleware that normalizes trailing slashes via 301 redirect
 *
 * @param mode - "strip" removes trailing slash, "add" adds trailing slash
 * @returns Function middleware that redirects non-canonical URLs
 *
 * @example
 * ```typescript
 * import {Router} from "@b9g/router";
 * import {trailingSlash} from "@b9g/router/middleware";
 *
 * const router = new Router();
 * router.use(trailingSlash("strip")); // Redirect /path/ → /path
 *
 * // Can also be scoped to specific paths
 * router.use("/api", trailingSlash("strip"));
 * ```
 */
export function trailingSlash(mode: TrailingSlashMode): FunctionMiddleware {
	return (req: Request) => {
		const url = new URL(req.url);
		const pathname = url.pathname;

		// Skip root path - "/" is valid either way
		if (pathname === "/") return;

		let newPathname: string | null = null;
		if (mode === "strip" && pathname.endsWith("/")) {
			newPathname = pathname.slice(0, -1);
		} else if (mode === "add" && !pathname.endsWith("/")) {
			newPathname = pathname + "/";
		}

		if (newPathname) {
			url.pathname = newPathname;
			return new Response(null, {
				status: 301,
				headers: {Location: url.toString()},
			});
		}
	};
}

// ============================================================================
// CORS
// ============================================================================

/**
 * CORS configuration options
 */
export interface CORSOptions {
	/**
	 * Allowed origins. Can be:
	 * - "*" for any origin (not recommended with credentials)
	 * - A specific origin string: "https://example.com"
	 * - An array of origins: ["https://example.com", "https://app.example.com"]
	 * - A function that receives the origin and returns true/false
	 *
	 * @default "*"
	 */
	origin?: string | string[] | ((origin: string) => boolean);

	/**
	 * Allowed HTTP methods
	 * @default ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"]
	 */
	methods?: string[];

	/**
	 * Allowed request headers
	 * @default ["Content-Type", "Authorization"]
	 */
	allowedHeaders?: string[];

	/**
	 * Headers exposed to the browser
	 */
	exposedHeaders?: string[];

	/**
	 * Whether to include credentials (cookies, authorization headers)
	 * Note: Cannot be used with origin: "*"
	 * @default false
	 */
	credentials?: boolean;

	/**
	 * Max age for preflight cache in seconds
	 * @default 86400 (24 hours)
	 */
	maxAge?: number;
}

const DEFAULT_CORS_METHODS = ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"];
const DEFAULT_CORS_HEADERS = ["Content-Type", "Authorization"];
const DEFAULT_CORS_MAX_AGE = 86400;

/**
 * Determine the allowed origin value based on configuration
 */
function getAllowedOrigin(
	config: string | string[] | ((origin: string) => boolean),
	requestOrigin: string,
): string | null {
	if (config === "*") {
		return "*";
	}

	if (typeof config === "string") {
		return config === requestOrigin ? config : null;
	}

	if (Array.isArray(config)) {
		return config.includes(requestOrigin) ? requestOrigin : null;
	}

	if (typeof config === "function") {
		return config(requestOrigin) ? requestOrigin : null;
	}

	return null;
}

/**
 * CORS middleware factory
 *
 * Handles Cross-Origin Resource Sharing headers and preflight requests.
 * Use as generator middleware to add CORS headers to all responses.
 *
 * @example
 * ```typescript
 * import {Router} from "@b9g/router";
 * import {cors} from "@b9g/router/middleware";
 *
 * const router = new Router();
 *
 * // Allow all origins
 * router.use(cors());
 *
 * // Allow specific origin with credentials
 * router.use(cors({
 *   origin: "https://myapp.com",
 *   credentials: true
 * }));
 *
 * // Allow multiple origins
 * router.use(cors({
 *   origin: ["https://app.example.com", "https://admin.example.com"]
 * }));
 *
 * // Dynamic origin validation
 * router.use(cors({
 *   origin: (origin) => origin.endsWith(".example.com")
 * }));
 * ```
 */
export function cors(options: CORSOptions = {}) {
	const {
		origin = "*",
		methods = DEFAULT_CORS_METHODS,
		allowedHeaders = DEFAULT_CORS_HEADERS,
		exposedHeaders,
		credentials = false,
		maxAge = DEFAULT_CORS_MAX_AGE,
	} = options;

	// Validate: credentials cannot be used with origin: "*"
	if (credentials && origin === "*") {
		throw new Error(
			'CORS: credentials cannot be used with origin: "*". Specify allowed origins explicitly.',
		);
	}

	return async function* (
		request: Request,
		_context: any,
	): AsyncGenerator<Request, Response | undefined, Response> {
		const requestOrigin = request.headers.get("Origin");

		// No Origin header = same-origin request, skip CORS
		if (!requestOrigin) {
			const response: Response = yield request;
			return response;
		}

		// Check if origin is allowed
		const allowedOrigin = getAllowedOrigin(origin, requestOrigin);
		if (!allowedOrigin) {
			// Origin not allowed
			if (request.method === "OPTIONS") {
				return new Response(null, {status: 403});
			}
			const response: Response = yield request;
			return response;
		}

		// Handle preflight (OPTIONS) requests
		if (request.method === "OPTIONS") {
			const headers = new Headers();

			headers.set("Access-Control-Allow-Origin", allowedOrigin);
			headers.set("Access-Control-Allow-Methods", methods.join(", "));
			headers.set("Access-Control-Allow-Headers", allowedHeaders.join(", "));
			headers.set("Access-Control-Max-Age", String(maxAge));

			if (credentials) {
				headers.set("Access-Control-Allow-Credentials", "true");
			}

			if (exposedHeaders?.length) {
				headers.set("Access-Control-Expose-Headers", exposedHeaders.join(", "));
			}

			headers.set("Vary", "Origin");

			return new Response(null, {status: 204, headers});
		}

		// For actual requests, add CORS headers to response
		const response: Response = yield request;

		// Clone response to add headers
		const newHeaders = new Headers(response.headers);
		newHeaders.set("Access-Control-Allow-Origin", allowedOrigin);

		if (credentials) {
			newHeaders.set("Access-Control-Allow-Credentials", "true");
		}

		if (exposedHeaders?.length) {
			newHeaders.set(
				"Access-Control-Expose-Headers",
				exposedHeaders.join(", "),
			);
		}

		newHeaders.set("Vary", "Origin");

		return new Response(response.body, {
			status: response.status,
			statusText: response.statusText,
			headers: newHeaders,
		});
	};
}

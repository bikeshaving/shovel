/**
 * Router middleware for authentication and access control
 * Includes OAuth2 integration, session management, and CORS
 */

import {OAuth2Client, OAuth2Tokens} from "./oauth2.js";
import type {FunctionMiddleware} from "@b9g/router";

// ============================================================================
// CORS MIDDLEWARE
// ============================================================================

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
 * // Allow all origins
 * router.use(cors());
 *
 * @example
 * // Allow specific origin with credentials
 * router.use(cors({
 *   origin: "https://myapp.com",
 *   credentials: true
 * }));
 *
 * @example
 * // Allow multiple origins
 * router.use(cors({
 *   origin: ["https://app.example.com", "https://admin.example.com"]
 * }));
 *
 * @example
 * // Dynamic origin validation
 * router.use(cors({
 *   origin: (origin) => origin.endsWith(".example.com")
 * }));
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

// ============================================================================
// HELPER: Get cookieStore from ServiceWorker global
// ============================================================================

/**
 * Get cookieStore from ServiceWorker global scope
 * Uses AsyncContext-backed self.cookieStore for per-request isolation
 */
function getCookieStore(_context: any) {
	const cookieStore = (self as any).cookieStore;
	if (!cookieStore) {
		throw new Error(
			"CookieStore not available - ensure code runs within ServiceWorker fetch handler",
		);
	}
	return cookieStore;
}

// ============================================================================
// MIDDLEWARE FACTORIES
// ============================================================================

/**
 * Create middleware to start OAuth2 flow
 * Redirects to authorization endpoint
 */
export function redirectToProvider(client: OAuth2Client): FunctionMiddleware {
	return async (request, context) => {
		const cookieStore = getCookieStore(context);
		const authURL = await client.startAuthorization(cookieStore);
		return Response.redirect(authURL, 302);
	};
}

/**
 * Create middleware to handle OAuth2 callback
 * Exchanges code for tokens and calls onSuccess
 */
export function handleCallback(
	client: OAuth2Client,
	options: {
		onSuccess: (
			tokens: OAuth2Tokens,
			request: Request,
			context: any,
		) => Response | Promise<Response>;
		onError?: (error: Error) => Response | Promise<Response>;
	},
): FunctionMiddleware {
	return async (request, context) => {
		try {
			const cookieStore = getCookieStore(context);
			const tokens = await client.handleCallback(request, cookieStore);

			// Call success handler
			return await options.onSuccess(tokens, request, context);
		} catch (error) {
			if (options.onError) {
				return await options.onError(error as Error);
			}

			// Default error handler
			return new Response(
				JSON.stringify({
					error: "Authentication failed",
					message: (error as Error).message,
				}),
				{
					status: 400,
					headers: {"Content-Type": "application/json"},
				},
			);
		}
	};
}

/**
 * Create middleware to require authentication
 * Checks for session token and adds user to context
 */
export function requireAuth(options?: {
	sessionCookieName?: string;
	onUnauthorized?: () => Response | Promise<Response>;
}): FunctionMiddleware {
	const sessionCookieName = options?.sessionCookieName || "session";

	return async (request, context) => {
		const cookieStore = getCookieStore(context);
		const session = await cookieStore.get(sessionCookieName);

		if (!session) {
			if (options?.onUnauthorized) {
				return await options.onUnauthorized();
			}

			return new Response(JSON.stringify({error: "Unauthorized"}), {
				status: 401,
				headers: {"Content-Type": "application/json"},
			});
		}

		// Add session to context for handlers
		context.session = session.value;

		// Continue to next middleware/handler
		return null;
	};
}

/**
 * Helper to store session token in cookie
 */
export async function createSession(
	cookieStore: any,
	tokens: OAuth2Tokens,
	options?: {
		sessionCookieName?: string;
		maxAge?: number;
	},
): Promise<void> {
	const sessionCookieName = options?.sessionCookieName || "session";
	const maxAge = options?.maxAge || tokens.expiresIn || 3600;

	await cookieStore.set({
		name: sessionCookieName,
		value: tokens.accessToken,
		path: "/",
		sameSite: "lax",
		expires: Date.now() + maxAge * 1000,
	});
}

/**
 * Helper to clear session cookie
 */
export async function clearSession(
	cookieStore: any,
	options?: {
		sessionCookieName?: string;
	},
): Promise<void> {
	const sessionCookieName = options?.sessionCookieName || "session";
	await cookieStore.delete(sessionCookieName);
}

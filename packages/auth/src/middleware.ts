/**
 * Router middleware for authentication
 * Integrates OAuth2 with @b9g/router
 */

import {OAuth2Client, OAuth2Tokens, OAuth2User} from "./oauth2.js";
import type {FunctionMiddleware} from "@b9g/router";

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
export function redirectToProvider(
	client: OAuth2Client,
): FunctionMiddleware {
	return async (request, context) => {
		const cookieStore = getCookieStore(context);
		const authUrl = await client.startAuthorization(cookieStore);
		return Response.redirect(authUrl, 302);
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

			return new Response(
				JSON.stringify({error: "Unauthorized"}),
				{
					status: 401,
					headers: {"Content-Type": "application/json"},
				},
			);
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

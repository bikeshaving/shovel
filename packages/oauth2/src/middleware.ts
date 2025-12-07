/**
 * Router middleware for authentication and access control
 * Includes OAuth2 integration and session management
 */

import {OAuth2Client, OAuth2Tokens} from "./index.js";
import type {FunctionMiddleware} from "@b9g/router";

// Augment RouteContext to include oauth2 property
// Importing this module adds oauth2 tokens to context
declare module "@b9g/router" {
	interface RouteContext {
		oauth2?: OAuth2Tokens;
	}
}

/**
 * Create middleware to start OAuth2 flow
 * Redirects to authorization endpoint
 */
export function redirectToProvider(client: OAuth2Client): FunctionMiddleware {
	return async () => {
		const authURL = await client.startAuthorization((self as any).cookieStore);
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
			const tokens = await client.handleCallback(
				request,
				(self as any).cookieStore,
			);

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
		const session = await (self as any).cookieStore.get(sessionCookieName);

		if (!session) {
			if (options?.onUnauthorized) {
				return await options.onUnauthorized();
			}

			return new Response(JSON.stringify({error: "Unauthorized"}), {
				status: 401,
				headers: {"Content-Type": "application/json"},
			});
		}

		// Add OAuth2 tokens to context for handlers
		context.oauth2 = session.value;

		// Continue to next middleware/handler
		return null;
	};
}

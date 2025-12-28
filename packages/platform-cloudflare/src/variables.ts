/**
 * Cloudflare Environment Storage
 *
 * Provides per-request access to Cloudflare's env object (KV, R2, D1 bindings, etc.)
 * via AsyncContext. Used by directory implementations to resolve bindings at runtime.
 */

import {AsyncContext} from "@b9g/async-context";

/**
 * Per-request storage for Cloudflare's env object.
 * Set by createFetchHandler() via envStorage.run().
 */
export const envStorage = new AsyncContext.Variable<Record<string, unknown>>();

/**
 * Get the current Cloudflare env or throw if not in request context.
 */
export function getEnv(): Record<string, unknown> {
	const env = envStorage.get();
	if (!env) {
		throw new Error(
			"Cloudflare env not available. Are you accessing bindings outside of a request context?",
		);
	}
	return env;
}

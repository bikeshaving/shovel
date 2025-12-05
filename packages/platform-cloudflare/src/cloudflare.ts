/**
 * Cloudflare-specific APIs for user code
 *
 * This module provides access to Cloudflare's per-request context (env bindings, ExecutionContext).
 * Import this in your ServiceWorker code when you need Cloudflare-specific functionality.
 *
 * @example
 * import { getCloudflareEnv, getCloudflareCtx } from "@b9g/platform-cloudflare/cloudflare";
 *
 * addEventListener("fetch", (event) => {
 *   const env = getCloudflareEnv<{ MY_KV: KVNamespace }>();
 *   const ctx = getCloudflareCtx();
 *   ctx.waitUntil(doBackgroundWork());
 * });
 */

import {AsyncContext} from "@b9g/async-context";

// ============================================================================
// CLOUDFLARE TYPES
// ============================================================================

/**
 * Cloudflare's ExecutionContext - passed to each request handler
 */
export interface ExecutionContext {
	waitUntil(promise: Promise<unknown>): void;
	passThroughOnException(): void;
}

/**
 * Cloudflare ASSETS binding interface
 */
export interface CFAssetsBinding {
	fetch(request: Request | string): Promise<Response>;
}

/** R2 object metadata */
export interface R2Object {
	key: string;
	uploaded: Date;
	httpMetadata?: {contentType?: string};
	arrayBuffer(): Promise<ArrayBuffer>;
}

/** R2 list result */
export interface R2Objects {
	objects: Array<{key: string}>;
	delimitedPrefixes: string[];
}

/** R2 bucket interface */
export interface R2Bucket {
	get(key: string): Promise<R2Object | null>;
	head(key: string): Promise<R2Object | null>;
	put(key: string, value: ArrayBuffer | Uint8Array): Promise<R2Object>;
	delete(key: string): Promise<void>;
	list(options?: {prefix?: string; delimiter?: string}): Promise<R2Objects>;
}

// ============================================================================
// PER-REQUEST CONTEXT (AsyncContext)
// ============================================================================

/** Per-request storage for Cloudflare's env object (KV, R2, D1 bindings) */
export const envStorage = new AsyncContext.Variable<Record<string, unknown>>();

/** Per-request storage for Cloudflare's ExecutionContext */
export const ctxStorage = new AsyncContext.Variable<ExecutionContext>();

/**
 * Get the current request's Cloudflare env object
 * Contains all bindings: KV namespaces, R2 buckets, D1 databases, etc.
 *
 * @example
 * const env = getCloudflareEnv<{ MY_KV: KVNamespace, STORAGE_R2: R2Bucket }>();
 * const value = await env.MY_KV.get("key");
 */
export function getCloudflareEnv<T = Record<string, unknown>>(): T | undefined {
	return envStorage.get() as T | undefined;
}

/**
 * Get the current request's Cloudflare ExecutionContext
 * Used for ctx.waitUntil() and other lifecycle methods
 *
 * @example
 * const ctx = getCloudflareCtx();
 * ctx.waitUntil(sendAnalytics());
 */
export function getCloudflareCtx(): ExecutionContext | undefined {
	return ctxStorage.get();
}

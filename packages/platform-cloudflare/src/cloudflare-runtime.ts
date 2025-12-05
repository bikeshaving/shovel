/**
 * Cloudflare Worker Runtime - Browser-safe ServiceWorkerGlobals setup
 *
 * This module is BROWSER-SAFE and can be bundled into Cloudflare Workers.
 * It only imports from browser-compatible modules:
 * - @b9g/platform/runtime (no fs/path)
 * - @b9g/filesystem (no fs/path in the index)
 * - @b9g/async-context (browser-safe)
 *
 * DO NOT import from @b9g/platform (the index) - it pulls in Node-only code.
 */

import {
	ServiceWorkerGlobals,
	ShovelServiceWorkerRegistration,
	CustomLoggerStorage,
} from "@b9g/platform/runtime";
import {CustomDirectoryStorage} from "@b9g/filesystem";
import {AsyncContext} from "@b9g/async-context";
import {getLogger} from "@logtape/logtape";
import type {R2Bucket} from "./filesystem-r2.js";
import {R2FileSystemDirectoryHandle} from "./filesystem-r2.js";

// ============================================================================
// Minimal Cloudflare Types (to avoid @cloudflare/workers-types global pollution)
// ============================================================================

/**
 * Cloudflare's ExecutionContext - passed to each request handler
 * Used for ctx.waitUntil() to extend request lifetime
 */
export interface ExecutionContext {
	waitUntil(promise: Promise<unknown>): void;
	passThroughOnException(): void;
}

// ============================================================================
// PER-REQUEST CONTEXT (AsyncContext)
// ============================================================================

/** Per-request storage for Cloudflare's env object (KV, R2, D1 bindings) */
const envStorage = new AsyncContext.Variable<Record<string, unknown>>();

/** Per-request storage for Cloudflare's ExecutionContext */
const ctxStorage = new AsyncContext.Variable<ExecutionContext>();

/**
 * Get the current request's Cloudflare env object
 * Contains all bindings: KV namespaces, R2 buckets, D1 databases, etc.
 */
export function getEnv<T = Record<string, unknown>>(): T | undefined {
	return envStorage.get() as T | undefined;
}

/**
 * Get the current request's Cloudflare ExecutionContext
 * Used for ctx.waitUntil() and other lifecycle methods
 */
export function getCtx(): ExecutionContext | undefined {
	return ctxStorage.get();
}

// ============================================================================
// CLOUDFLARE RUNTIME SETUP
// ============================================================================

// Module-level state (initialized once when module loads)
let _registration: ShovelServiceWorkerRegistration | null = null;
let _globals: ServiceWorkerGlobals | null = null;

/**
 * Initialize the Cloudflare runtime with ServiceWorkerGlobals
 * Called once when the worker module loads (before user code runs)
 */
export function initializeRuntime(): ShovelServiceWorkerRegistration {
	if (_registration) {
		return _registration;
	}

	_registration = new ShovelServiceWorkerRegistration();

	// Create directory storage with lazy R2 factory
	const directories = new CustomDirectoryStorage(
		createCloudflareR2DirectoryFactory(),
	);

	// Create ServiceWorkerGlobals
	_globals = new ServiceWorkerGlobals({
		registration: _registration,
		caches: globalThis.caches, // Cloudflare's native Cache API
		directories,
		loggers: new CustomLoggerStorage((...cats) => getLogger(cats)),
	});

	// Install globals (caches, directories, cookieStore, addEventListener, etc.)
	_globals.install();

	return _registration;
}

/**
 * Create the ES module fetch handler for Cloudflare Workers
 */
export function createFetchHandler(
	registration: ShovelServiceWorkerRegistration,
): (
	request: Request,
	env: unknown,
	ctx: ExecutionContext,
) => Promise<Response> {
	return async (
		request: Request,
		env: unknown,
		ctx: ExecutionContext,
	): Promise<Response> => {
		return envStorage.run(env as Record<string, unknown>, () =>
			ctxStorage.run(ctx, async () => {
				try {
					return await registration.handleRequest(request);
				} catch (error) {
					console.error("ServiceWorker error:", error);
					const err = error instanceof Error ? error : new Error(String(error));

					const isDev =
						typeof import.meta !== "undefined" &&
						import.meta.env?.MODE !== "production";
					if (isDev) {
						return new Response(
							`<!DOCTYPE html>
<html>
<head><title>500 Internal Server Error</title>
<style>body{font-family:system-ui;padding:2rem;max-width:800px;margin:0 auto}h1{color:#c00}pre{background:#f5f5f5;padding:1rem;overflow-x:auto}</style>
</head>
<body>
<h1>500 Internal Server Error</h1>
<p>${escapeHtml(err.message)}</p>
<pre>${escapeHtml(err.stack || "No stack trace")}</pre>
</body></html>`,
							{status: 500, headers: {"Content-Type": "text/html"}},
						);
					}

					return new Response("Internal Server Error", {status: 500});
				}
			}),
		);
	};
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * Create a directory factory for Cloudflare that uses R2 bindings
 */
function createCloudflareR2DirectoryFactory() {
	return async (name: string): Promise<FileSystemDirectoryHandle> => {
		const env = getEnv();
		if (!env) {
			throw new Error(
				`Cannot access directory "${name}": Cloudflare env not available. ` +
					`Are you accessing directories outside of a request context?`,
			);
		}

		const bindingName = `${name.toUpperCase()}_R2`;
		const r2Bucket = env[bindingName] as R2Bucket | undefined;

		if (!r2Bucket) {
			throw new Error(
				`R2 bucket binding "${bindingName}" not found. ` +
					`Configure in wrangler.toml:\n\n` +
					`[[r2_buckets]]\n` +
					`binding = "${bindingName}"\n` +
					`bucket_name = "your-bucket-name"`,
			);
		}

		return new R2FileSystemDirectoryHandle(r2Bucket, "");
	};
}

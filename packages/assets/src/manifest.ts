/**
 * Asset manifest registry.
 *
 * The build bundles the manifest into the worker as the `shovel:assets`
 * virtual module, and the generated worker entry registers it here at
 * startup. Library code (directory handles, middleware) reads it through
 * this registry instead of importing `shovel:assets` directly — a static
 * `import("shovel:assets")` in library source breaks any consumer bundling
 * outside a shovel build (plain wrangler/esbuild/Vite cannot resolve the
 * virtual module), whereas the generated entry only exists in shovel builds.
 *
 * This module is dependency-free so registering the manifest doesn't drag
 * middleware code (mime, caching) into every worker bundle.
 */

import type {AssetManifest} from "./middleware.js";

let registeredManifest: AssetManifest | null = null;

/** Register the build's asset manifest. Called by generated worker entries. */
export function setAssetsManifest(manifest: AssetManifest | null): void {
	registeredManifest = manifest;
}

/**
 * The registered asset manifest, or null outside a shovel build (or before
 * the worker entry has run).
 */
export function getAssetsManifest(): AssetManifest | null {
	return registeredManifest;
}

export type {AssetManifest, AssetManifestEntry} from "./middleware.js";

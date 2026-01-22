/**
 * Type declarations for the shovel:assets virtual module.
 * This module is resolved by esbuild at build time.
 */
declare module "shovel:assets" {
	import type {AssetManifest} from "./middleware.js";

	const manifest: AssetManifest;
	export default manifest;
}

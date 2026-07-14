/**
 * Type declarations for the shovel:assets virtual module.
 * Resolved by esbuild at build time; absent outside a shovel build.
 */
declare module "shovel:assets" {
	const manifest: {assets: Record<string, {url?: string}>};
	export default manifest;
}

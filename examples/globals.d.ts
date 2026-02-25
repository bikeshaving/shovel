/**
 * Asset module declarations for Shovel examples.
 *
 * When assets are imported with `with { assetBase: "/static/" }`,
 * the build system resolves them to content-hashed URL strings.
 * These declarations tell TypeScript that such imports are strings.
 */

declare module "*.css" {
	const url: string;
	export default url;
}

declare module "*.svg" {
	const url: string;
	export default url;
}

declare module "*.ico" {
	const url: string;
	export default url;
}

declare module "@uswds/uswds/css/uswds.min.css" {
	const url: string;
	export default url;
}

declare module "@uswds/uswds" {
	const url: string;
	export default url;
}

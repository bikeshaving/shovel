/**
 * Type declarations for the shovel:config virtual module.
 * This module is resolved by esbuild at build time.
 */
declare module "shovel:config" {
	import type {ShovelConfig} from "./runtime.js";

	export const config: ShovelConfig;
	export type {ShovelConfig};
}

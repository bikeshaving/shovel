/**
 * Type declarations for the shovel:config virtual module.
 * This module is resolved by esbuild at build time.
 */
declare module "shovel:config" {
	import type {LoggingConfig} from "./runtime.js";

	export interface ShovelConfig {
		port?: number;
		host?: string;
		workers?: number;
		platform?: string;
		logging: LoggingConfig;
		caches?: Record<string, {provider?: string; [key: string]: unknown}>;
		buckets?: Record<string, {provider?: string; [key: string]: unknown}>;
	}

	export const config: ShovelConfig;
}

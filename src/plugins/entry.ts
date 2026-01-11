/**
 * ESBuild plugin for shovel:entry virtual modules.
 *
 * Provides virtual entry points that wrap the user's ServiceWorker code
 * with runtime initialization (platform-specific bootstrapping).
 *
 * Supports multiple entry points via shovel:entry:<name> pattern:
 * - shovel:entry:index - Main entry point (supervisor for Node/Bun)
 * - shovel:entry:worker - Worker entry point (for Node/Bun worker processes)
 * - shovel:entry:server - Combined entry point (for Cloudflare single-file)
 */

import * as ESBuild from "esbuild";
import type {ProductionEntryPoints} from "@b9g/platform";

/**
 * Create the shovel:entry virtual module plugin.
 *
 * This provides virtual entry points that wrap the user's ServiceWorker code
 * with runtime initialization (platform-specific bootstrapping).
 *
 * @param projectRoot - Root directory for import resolution
 * @param entryPoints - Map of entry point names to their generated code
 *                      e.g., {index: "supervisor code...", worker: "worker code..."}
 */
export function createEntryPlugin(
	projectRoot: string,
	entryPoints: ProductionEntryPoints,
): ESBuild.Plugin {
	return {
		name: "shovel-entry",
		setup(build) {
			// Match shovel:entry or shovel:entry:<name>
			build.onResolve({filter: /^shovel:entry(:.+)?$/}, (args) => ({
				path: args.path,
				namespace: "shovel-entry",
			}));

			build.onLoad({filter: /.*/, namespace: "shovel-entry"}, (args) => {
				// Extract entry name: "shovel:entry" -> first key, "shovel:entry:worker" -> "worker"
				const match = args.path.match(/^shovel:entry(?::(.+))?$/);
				const entryName = match?.[1] ?? Object.keys(entryPoints)[0];

				const contents = entryPoints[entryName];
				if (!contents) {
					const available = Object.keys(entryPoints).join(", ");
					return {
						errors: [
							{
								text: `Unknown entry point "${entryName}". Available: ${available}`,
							},
						],
					};
				}

				return {
					contents,
					loader: "js",
					resolveDir: projectRoot,
				};
			});
		},
	};
}

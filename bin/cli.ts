// Load config and configure logging before anything else
import {resolve} from "path";
import {spawnSync} from "child_process";
import {findProjectRoot} from "../src/utils/project.js";
import {loadConfig, DEFAULTS, type SinkConfig} from "../src/utils/config.js";
import {configureLogging} from "@b9g/platform/runtime";

const projectRoot = findProjectRoot();
const config = loadConfig(projectRoot);

// Reify sink configs by dynamically importing their modules at runtime.
// This is similar to config.ts's reifyModule(), but operates at runtime (dynamic import)
// rather than build-time (static import codegen). Can't share code because CLI runs
// before build, so we need runtime imports here.
async function reifySinks(
	sinks: Record<string, SinkConfig> | undefined,
	baseDir: string,
): Promise<Record<string, {impl: unknown; [key: string]: unknown}>> {
	const reified: Record<string, {impl: unknown; [key: string]: unknown}> = {};
	for (const [name, sinkConfig] of Object.entries(sinks ?? {})) {
		const {module: modulePath, export: exportName, ...rest} = sinkConfig;
		if (modulePath) {
			// Resolve relative paths against the config file location (baseDir)
			// Package names (no ./ or ../) are left as-is for Node to resolve from node_modules
			const resolvedPath =
				modulePath.startsWith("./") || modulePath.startsWith("../")
					? resolve(baseDir, modulePath)
					: modulePath;
			// eslint-disable-next-line no-restricted-syntax -- CLI runtime import of user-configured sinks
			const mod = await import(resolvedPath);
			const impl = exportName ? mod[exportName] : mod.default;
			reified[name] = {...rest, impl};
		} else if (sinkConfig.impl) {
			// Already reified (shouldn't happen in CLI, but handle it)
			reified[name] = sinkConfig as {impl: unknown};
		}
	}
	return reified;
}

const reifiedSinks = await reifySinks(config.logging?.sinks, projectRoot);
await configureLogging({
	sinks: reifiedSinks,
	loggers: config.logging?.loggers,
});

import {Command} from "commander";
import pkg from "../package.json" with {type: "json"};

const program = new Command();

program.name("shovel").description("Shovel CLI").version(pkg.version);

/**
 * Re-exec under a different runtime if --platform requests it.
 * Called at the start of command actions that support --platform.
 */
function checkPlatformReexec(options: {platform?: string}) {
	const platform = options.platform ?? config.platform;
	const isBun = typeof globalThis.Bun !== "undefined";

	if (platform === "bun" && !isBun) {
		// Node → Bun
		const result = spawnSync("bun", process.argv.slice(1), {stdio: "inherit"});
		process.exit(result.status ?? 1);
	}

	if (platform === "node" && isBun) {
		// Bun → Node
		const result = Bun.spawnSync(["node", ...process.argv.slice(1)], {
			stdout: "inherit",
			stderr: "inherit",
			stdin: "inherit",
		});
		process.exit(result.exitCode ?? 1);
	}
}

/**
 * Development server command
 */
program
	.command("develop <entrypoint>")
	.description("Start development server with hot reload")
	.option(
		"-o, --origin <url>",
		"Origin URL for local HTTPS (e.g., https://myapp.localhost)",
	)
	.option("-p, --port <port>", "Port to listen on (shorthand for http://localhost:<port>)")
	.option("-h, --host <host>", "Host to bind to")
	.option(
		"-w, --workers <count>",
		"Number of workers (default: CPU cores)",
		DEFAULTS.WORKERS,
	)
	.option("--platform <name>", "Runtime platform (node, cloudflare, bun)")
	.action(async (entrypoint, options) => {
		checkPlatformReexec(options);
		const {developCommand} = await import("../src/commands/develop.ts");
		await developCommand(entrypoint, options, config);
	});

/**
 * Build command - supports targeting different platforms
 */
program
	.command("build <entrypoint>")
	.description("Build app for production")
	.option("--platform <name>", "Runtime platform (node, cloudflare, bun)")
	.option(
		"--lifecycle [stage]",
		"Run ServiceWorker lifecycle after build (install or activate, default: activate)",
	)
	.action(async (entrypoint, options) => {
		checkPlatformReexec(options);
		const {buildCommand} = await import("../src/commands/build.ts");
		await buildCommand(entrypoint, options, config);
		// Workaround for Bun-specific issue: esbuild keeps child processes alive
		// even after build() completes, preventing the Node/Bun process from exiting.
		// This is documented in https://github.com/evanw/esbuild/issues/3558
		// Node.js exits naturally via reference counting, but Bun doesn't.
		process.exit(0);
	});

program.parse();

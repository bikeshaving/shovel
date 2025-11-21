#!/usr/bin/env sh
//bin/true; exec "$([ "${npm_config_user_agent#bun/}" != "$npm_config_user_agent" ] && echo bun || echo node)" "$0" "$@"
import {Command} from "commander";
import pkg from "../package.json" with {type: "json"};
import {DEFAULTS} from "../src/esbuild/config.js";

import {developCommand} from "../src/commands/develop.ts";
import {activateCommand} from "../src/commands/activate.ts";
import {infoCommand} from "../src/commands/info.ts";

const program = new Command();

program.name("shovel").description("Shovel CLI").version(pkg.version);

/**
 * Development server command
 */
program
	.command("develop <entrypoint>")
	.description("Start development server with hot reload")
	.option("-p, --port <port>", "Port to listen on", DEFAULTS.SERVER.PORT)
	.option("-h, --host <host>", "Host to bind to", DEFAULTS.SERVER.HOST)
	.option(
		"-w, --workers <count>",
		"Number of workers (default: CPU cores)",
		DEFAULTS.WORKERS,
	)
	.option("-v, --verbose", "Verbose logging", false)
	.option("--platform <name>", "Runtime platform (node, cloudflare, bun)")
	.option("--cache <type>", "Cache type (memory, redis)")
	.option("--filesystem <type>", "Filesystem type (local, s3, r2)")
	.action(developCommand);

/**
 * Build command - supports targeting different platforms
 */
program
	.command("build <entrypoint>")
	.description("Build app for production")
	.option("-w, --workers <count>", "Worker count (defaults to 1)", undefined)
	.option("--platform <name>", "Runtime platform (node, cloudflare, bun)")
	.action(async (entrypoint, options) => {
		const {buildCommand} = await import("../src/commands/build.ts");
		await buildCommand(entrypoint, options);
	});

/**
 * Activate command - runs ServiceWorker lifecycle for static generation
 */
program
	.command("activate <entrypoint>")
	.description(
		"Activate ServiceWorker (for static site generation in activate event)",
	)
	.option("-v, --verbose", "Verbose logging", false)
	.option("--platform <name>", "Runtime platform (node, cloudflare, bun)")
	.option("--cache <type>", "Cache type (memory, redis)")
	.option("--filesystem <type>", "Filesystem type (local, s3, r2)")
	.option(
		"-w, --workers <count>",
		"Number of workers",
		DEFAULTS.WORKERS.toString(),
	)
	.action(activateCommand);

/**
 * Platform info command
 */
program
	.command("info")
	.description("Display platform and runtime information")
	.action(infoCommand);

program.parse();

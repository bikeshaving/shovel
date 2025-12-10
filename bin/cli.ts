#!/usr/bin/env sh
//bin/true; exec "$([ "${npm_config_user_agent#bun/}" != "$npm_config_user_agent" ] && echo bun || echo node)" "$0" "$@"

// Load config and configure logging before anything else
import {findProjectRoot} from "../src/utils/project.js";
import {loadConfig, DEFAULTS} from "../src/utils/config.js";
import {configureLogging} from "@b9g/platform/runtime";

const projectRoot = findProjectRoot();
const config = loadConfig(projectRoot);
await configureLogging(config.logging);

import {Command} from "commander";
import pkg from "../package.json" with {type: "json"};

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
	.action(async (entrypoint, options) => {
		const {developCommand} = await import("../src/commands/develop.ts");
		await developCommand(entrypoint, options, config);
	});

/**
 * Build command - supports targeting different platforms
 */
program
	.command("build <entrypoint>")
	.description("Build app for production")
	.option("-w, --workers <count>", "Worker count (defaults to 1)", undefined)
	.option("-v, --verbose", "Verbose logging", false)
	.option("--platform <name>", "Runtime platform (node, cloudflare, bun)")
	.action(async (entrypoint, options) => {
		const {buildCommand} = await import("../src/commands/build.ts");
		await buildCommand(entrypoint, options, config);
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
	.option(
		"-w, --workers <count>",
		"Number of workers",
		DEFAULTS.WORKERS.toString(),
	)
	.action(async (entrypoint, options) => {
		const {activateCommand} = await import("../src/commands/activate.ts");
		await activateCommand(entrypoint, options, config);
	});

/**
 * Platform info command
 */
program
	.command("info")
	.description("Display platform and runtime information")
	.action(async () => {
		const {infoCommand} = await import("../src/commands/info.ts");
		await infoCommand();
	});

/**
 * Database commands (drizzle-kit wrapper)
 */
const db = program.command("db").description("Database commands (drizzle-kit)");

db.command("generate [database]")
	.description("Generate SQL migration files from schema changes")
	.option("--name <name>", "Custom migration name")
	.action(async (database, options) => {
		const {dbGenerateCommand} = await import("../src/commands/db.ts");
		await dbGenerateCommand(database, options, config);
	});

db.command("migrate [database]")
	.description("Apply pending migrations to the database")
	.action(async (database, options) => {
		const {dbMigrateCommand} = await import("../src/commands/db.ts");
		await dbMigrateCommand(database, options, config);
	});

db.command("push [database]")
	.description("Push schema changes directly (no migration files)")
	.option("--force", "Skip confirmation for destructive changes")
	.action(async (database, options) => {
		const {dbPushCommand} = await import("../src/commands/db.ts");
		await dbPushCommand(database, options, config);
	});

db.command("studio [database]")
	.description("Launch Drizzle Studio GUI")
	.option("--port <port>", "Studio port", "4983")
	.option("--host <host>", "Studio host", "127.0.0.1")
	.action(async (database, options) => {
		const {dbStudioCommand} = await import("../src/commands/db.ts");
		await dbStudioCommand(database, options, config);
	});

program.parse();

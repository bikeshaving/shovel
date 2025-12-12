/**
 * Database CLI commands - wraps drizzle-kit
 *
 * Translates shovel.json database config into drizzle.config.ts format
 * and shells out to drizzle-kit for migrations, schema push, and studio.
 */

import {spawn} from "child_process";
import {writeFileSync, mkdirSync, existsSync} from "fs";
import {join} from "path";
import {getLogger} from "@logtape/logtape";
import type {ProcessedShovelConfig, DatabaseConfig} from "../utils/config.js";
import {loadRawConfig, exprToCode} from "../utils/config.js";
import {findProjectRoot} from "../utils/project.js";

const logger = getLogger(["shovel", "cli"]);

// ============================================================================
// Types
// ============================================================================

interface ResolvedDatabase {
	name: string;
	config: DatabaseConfig;
}

interface DbCommandOptions {
	name?: string;
	force?: boolean;
	port?: string;
	host?: string;
}

// ============================================================================
// Dialect Mapping
// ============================================================================

/**
 * Map Shovel dialect to drizzle-kit dialect
 */
function mapDialect(dialect: string): string {
	const map: Record<string, string> = {
		postgresql: "postgresql",
		mysql: "mysql",
		sqlite: "sqlite",
		"bun-sqlite": "sqlite",
		"bun-sql": "sqlite", // Bun.SQL defaults to sqlite for local files
		libsql: "turso",
		d1: "sqlite",
	};
	return map[dialect] ?? dialect;
}

// ============================================================================
// Database Resolution
// ============================================================================

/**
 * Resolve which database to operate on
 *
 * If name is provided, use that database.
 * Otherwise, default to "main" if it exists, or the first configured database.
 */
function resolveDatabase(
	name: string | undefined,
	config: ProcessedShovelConfig,
): ResolvedDatabase {
	const databases = config.databases;

	if (!databases || Object.keys(databases).length === 0) {
		throw new Error(
			`No databases configured in shovel.json.

Add a database configuration:
  {
    "databases": {
      "main": {
        "dialect": "postgresql",
        "driver": { "module": "postgres" },
        "url": "DATABASE_URL",
        "schema": "./src/db/schema.ts"
      }
    }
  }`,
		);
	}

	if (name) {
		const dbConfig = databases[name];
		if (!dbConfig) {
			const available = Object.keys(databases).join(", ");
			throw new Error(
				`Database "${name}" not found.\n\nAvailable databases: ${available}`,
			);
		}
		return {name, config: dbConfig};
	}

	// Default to "main" if it exists, otherwise first database
	const dbName = databases["main"] ? "main" : Object.keys(databases)[0];
	return {name: dbName, config: databases[dbName]};
}

// ============================================================================
// Config Generation
// ============================================================================

/**
 * Generate drizzle.config.ts content from database config
 *
 * Uses the raw config URL expression so env vars become process.env.X
 * (secrets aren't written to disk as literals).
 */
function generateDrizzleConfig(
	name: string,
	dbConfig: DatabaseConfig,
	rawUrl: string,
): string {
	const dialect = mapDialect(dbConfig.dialect);
	const schema = dbConfig.schema;

	// Convert URL expression to JS code (env vars → process.env.X)
	const urlCode = exprToCode(rawUrl);

	return `import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: ${JSON.stringify(dialect)},
  schema: ${JSON.stringify(schema)},
  out: "./migrations/${name}",
  dbCredentials: {
    url: ${urlCode},
  },
});
`;
}

/**
 * Write the generated drizzle config to disk
 */
function writeDrizzleConfig(projectRoot: string, content: string): string {
	const configDir = join(projectRoot, "dist", "server");
	const configPath = join(configDir, "drizzle.config.ts");

	// Ensure directory exists
	if (!existsSync(configDir)) {
		mkdirSync(configDir, {recursive: true});
	}

	writeFileSync(configPath, content, "utf-8");
	return configPath;
}

// ============================================================================
// Drizzle-kit Execution
// ============================================================================

/**
 * Run a drizzle-kit command
 */
async function runDrizzleKit(
	command: string,
	configPath: string,
	extraArgs: string[] = [],
): Promise<void> {
	return new Promise((resolve, reject) => {
		const args = [command, `--config=${configPath}`, ...extraArgs];

		logger.info("Running: npx drizzle-kit {args}", {args: args.join(" ")});

		const proc = spawn("npx", ["drizzle-kit", ...args], {
			stdio: "inherit",
			shell: true,
		});

		proc.on("error", (err) => {
			if ((err as any).code === "ENOENT") {
				reject(
					new Error(
						`drizzle-kit not found.\n\nInstall it:\n  bun add -d drizzle-kit`,
					),
				);
			} else {
				reject(err);
			}
		});

		proc.on("close", (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`drizzle-kit ${command} exited with code ${code}`));
			}
		});
	});
}

// ============================================================================
// Command Handlers
// ============================================================================

/**
 * shovel db generate [database]
 *
 * Generate SQL migration files from schema changes
 */
export async function dbGenerateCommand(
	database: string | undefined,
	options: DbCommandOptions,
	config: ProcessedShovelConfig,
): Promise<void> {
	const projectRoot = findProjectRoot();
	const {name, config: dbConfig} = resolveDatabase(database, config);
	const rawConfig = loadRawConfig(projectRoot);
	const rawUrl = rawConfig.databases?.[name]?.url ?? dbConfig.url;

	logger.info("Generating migrations for database: {name}", {name});

	// Generate and write drizzle config
	const drizzleConfig = generateDrizzleConfig(name, dbConfig, rawUrl);
	const configPath = writeDrizzleConfig(projectRoot, drizzleConfig);

	// Build extra args
	const extraArgs: string[] = [];
	if (options.name) {
		extraArgs.push(`--name=${options.name}`);
	}

	// Run drizzle-kit generate
	await runDrizzleKit("generate", configPath, extraArgs);
}

/**
 * shovel db migrate [database]
 *
 * Apply pending migrations to the database
 */
export async function dbMigrateCommand(
	database: string | undefined,
	_options: DbCommandOptions,
	config: ProcessedShovelConfig,
): Promise<void> {
	const projectRoot = findProjectRoot();
	const {name, config: dbConfig} = resolveDatabase(database, config);
	const rawConfig = loadRawConfig(projectRoot);
	const rawUrl = rawConfig.databases?.[name]?.url ?? dbConfig.url;

	logger.info("Applying migrations for database: {name}", {name});

	// Generate and write drizzle config
	const drizzleConfig = generateDrizzleConfig(name, dbConfig, rawUrl);
	const configPath = writeDrizzleConfig(projectRoot, drizzleConfig);

	// Run drizzle-kit migrate
	await runDrizzleKit("migrate", configPath);
}

/**
 * shovel db push [database]
 *
 * Push schema changes directly to the database (no migration files)
 */
export async function dbPushCommand(
	database: string | undefined,
	options: DbCommandOptions,
	config: ProcessedShovelConfig,
): Promise<void> {
	const projectRoot = findProjectRoot();
	const {name, config: dbConfig} = resolveDatabase(database, config);
	const rawConfig = loadRawConfig(projectRoot);
	const rawUrl = rawConfig.databases?.[name]?.url ?? dbConfig.url;

	logger.info("Pushing schema for database: {name}", {name});

	// Generate and write drizzle config
	const drizzleConfig = generateDrizzleConfig(name, dbConfig, rawUrl);
	const configPath = writeDrizzleConfig(projectRoot, drizzleConfig);

	// Build extra args
	const extraArgs: string[] = [];
	if (options.force) {
		extraArgs.push("--force");
	}

	// Run drizzle-kit push
	await runDrizzleKit("push", configPath, extraArgs);
}

/**
 * shovel db studio [database]
 *
 * Launch Drizzle Studio GUI
 */
export async function dbStudioCommand(
	database: string | undefined,
	options: DbCommandOptions,
	config: ProcessedShovelConfig,
): Promise<void> {
	const projectRoot = findProjectRoot();
	const {name, config: dbConfig} = resolveDatabase(database, config);
	const rawConfig = loadRawConfig(projectRoot);
	const rawUrl = rawConfig.databases?.[name]?.url ?? dbConfig.url;

	logger.info("Launching Drizzle Studio for database: {name}", {name});

	// Generate and write drizzle config
	const drizzleConfig = generateDrizzleConfig(name, dbConfig, rawUrl);
	const configPath = writeDrizzleConfig(projectRoot, drizzleConfig);

	// Build extra args
	const extraArgs: string[] = [];
	if (options.port) {
		extraArgs.push(`--port=${options.port}`);
	}
	if (options.host) {
		extraArgs.push(`--host=${options.host}`);
	}

	// Run drizzle-kit studio
	await runDrizzleKit("studio", configPath, extraArgs);
}

// ============================================================================
// Exported utilities for testing
// ============================================================================

export {resolveDatabase, generateDrizzleConfig, mapDialect};

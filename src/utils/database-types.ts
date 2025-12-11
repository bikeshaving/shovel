/**
 * Storage type generation utilities.
 *
 * Generates TypeScript declaration files with typed overloads for:
 * - DatabaseStorage.open() - returns typed Drizzle instances
 * - DirectoryStorage.open() - validates directory names at compile time
 *
 * Based on configurations in shovel.json files across the workspace.
 */

import {readFileSync, readdirSync, existsSync} from "fs";
import {join, resolve, relative} from "path";
import type {DatabaseDialect, RawShovelConfig} from "./config.js";
import {loadRawConfig} from "./config.js";
import {findWorkspaceRoot} from "./project.js";

/**
 * Mapping from shovel.json dialect to Drizzle ORM type information.
 */
const DIALECT_TYPE_MAP: Record<
	DatabaseDialect,
	{type: string; import: string}
> = {
	"bun-sqlite": {type: "BunSQLiteDatabase", import: "drizzle-orm/bun-sqlite"},
	sqlite: {type: "BaseSQLiteDatabase", import: "drizzle-orm/sqlite-core"},
	postgresql: {type: "PgDatabase", import: "drizzle-orm/pg-core"},
	mysql: {type: "MySqlDatabase", import: "drizzle-orm/mysql-core"},
	libsql: {type: "LibSQLDatabase", import: "drizzle-orm/libsql"},
	d1: {type: "DrizzleD1Database", import: "drizzle-orm/d1"},
};

/**
 * Information about a database discovered from shovel.json.
 */
export interface DatabaseInfo {
	/** Database name from shovel.json */
	name: string;
	/** Database dialect */
	dialect: DatabaseDialect;
	/** Absolute path to schema file */
	schemaPath: string;
	/** Package directory containing the shovel.json */
	packageDir: string;
}

/**
 * Simple glob-like pattern matcher for workspace patterns.
 * Supports patterns like "packages/*" or "examples/*"
 */
function matchWorkspacePattern(
	workspaceRoot: string,
	pattern: string,
): string[] {
	// Handle simple wildcard patterns like "packages/*"
	if (pattern.endsWith("/*")) {
		const base = pattern.slice(0, -2);
		const baseDir = join(workspaceRoot, base);
		if (!existsSync(baseDir)) return [];

		const entries = readdirSync(baseDir, {withFileTypes: true});
		return entries
			.filter((e) => e.isDirectory())
			.map((e) => join(baseDir, e.name))
			.filter((dir) => existsSync(join(dir, "package.json")));
	}

	// Handle literal paths
	const fullPath = join(workspaceRoot, pattern);
	if (existsSync(join(fullPath, "package.json"))) {
		return [fullPath];
	}
	return [];
}

/**
 * Discover all databases across workspace packages.
 * Coalesces databases from all packages with shovel.json.
 *
 * The current project's databases take precedence on name conflicts.
 *
 * @param projectRoot - Root directory of the current project
 * @returns Array of discovered databases
 */
export function discoverWorkspaceDatabases(projectRoot: string): DatabaseInfo[] {
	const databases: DatabaseInfo[] = [];
	const seenNames = new Set<string>();

	// First, add databases from the current project
	const projectConfig = loadRawConfig(projectRoot);
	if (projectConfig.databases) {
		for (const [name, config] of Object.entries(projectConfig.databases)) {
			if (config.schema) {
				databases.push({
					name,
					dialect: config.dialect,
					schemaPath: resolve(projectRoot, config.schema),
					packageDir: projectRoot,
				});
				seenNames.add(name);
			}
		}
	}

	// Then, discover databases from workspace packages
	const workspaceRoot = findWorkspaceRoot(projectRoot);
	if (workspaceRoot && workspaceRoot !== projectRoot) {
		const pkgJson = JSON.parse(
			readFileSync(join(workspaceRoot, "package.json"), "utf-8"),
		);
		const patterns: string[] = pkgJson.workspaces || [];

		for (const pattern of patterns) {
			const pkgDirs = matchWorkspacePattern(workspaceRoot, pattern);
			for (const pkgDir of pkgDirs) {
				if (pkgDir === projectRoot) continue; // Already processed

				const config = loadRawConfig(pkgDir);
				if (config.databases) {
					for (const [name, dbConfig] of Object.entries(config.databases)) {
						if (seenNames.has(name)) {
							// Skip duplicate names - current project takes precedence
							continue;
						}
						if (dbConfig.schema) {
							databases.push({
								name,
								dialect: dbConfig.dialect,
								schemaPath: resolve(pkgDir, dbConfig.schema),
								packageDir: pkgDir,
							});
							seenNames.add(name);
						}
					}
				}
			}
		}
	}

	return databases;
}

/**
 * Discover all directory names from project config.
 *
 * @param projectRoot - Root directory of the current project
 * @returns Array of directory names
 */
export function discoverDirectoryNames(projectRoot: string): string[] {
	const config = loadRawConfig(projectRoot);
	if (!config.directories) {
		return [];
	}
	return Object.keys(config.directories);
}

/**
 * Sanitize a name to be a valid TypeScript variable name.
 */
function sanitizeVarName(name: string): string {
	return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Generate TypeScript declaration file with typed overloads for storage APIs.
 *
 * @param databases - Array of database info from discoverWorkspaceDatabases
 * @param directoryNames - Array of directory names from discoverDirectoryNames
 * @param outDir - Output directory where shovel.d.ts will be written
 * @returns Generated TypeScript declaration file content, or empty string if nothing to generate
 */
export function generateStorageTypes(
	databases: DatabaseInfo[],
	directoryNames: string[],
	outDir: string,
): string {
	if (databases.length === 0 && directoryNames.length === 0) {
		return "";
	}

	const imports: string[] = [];
	const databaseOverloads: string[] = [];
	const seenDialectImports = new Set<string>();

	// Generate database overloads
	for (const db of databases) {
		const dialectInfo = DIALECT_TYPE_MAP[db.dialect];
		if (!dialectInfo) continue;

		// Import Drizzle type (dedupe by import path)
		if (!seenDialectImports.has(dialectInfo.import)) {
			imports.push(
				`import type {${dialectInfo.type}} from "${dialectInfo.import}";`,
			);
			seenDialectImports.add(dialectInfo.import);
		}

		// Import schema - use relative path from outDir
		const schemaVarName = `schema_${sanitizeVarName(db.name)}`;
		let relativeSchemaPath = relative(outDir, db.schemaPath).replace(
			/\.ts$/,
			"",
		);
		// Ensure relative path starts with ./ or ../
		if (!relativeSchemaPath.startsWith(".")) {
			relativeSchemaPath = "./" + relativeSchemaPath;
		}
		imports.push(
			`import type * as ${schemaVarName} from "${relativeSchemaPath}";`,
		);

		// Generate overload
		databaseOverloads.push(
			`    open(name: "${db.name}"): Promise<${dialectInfo.type}<typeof ${schemaVarName}>>;`,
		);
	}

	// Generate directory type (union of valid names)
	let directorySection = "";
	if (directoryNames.length > 0) {
		const dirUnion = directoryNames.map((n) => `"${n}"`).join(" | ");
		directorySection = `
  /**
   * Valid directory names from shovel.json.
   * Using an invalid name will cause a TypeScript error.
   */
  type ValidDirectoryName = ${dirUnion};

  interface DirectoryStorage {
    open(name: ValidDirectoryName): Promise<FileSystemDirectoryHandle>;
    has(name: ValidDirectoryName): Promise<boolean>;
  }
`;
	}

	// Build the final declaration
	const sections: string[] = [];

	if (databaseOverloads.length > 0) {
		sections.push(`  interface DatabaseStorage {
${databaseOverloads.join("\n")}
  }`);
	}

	if (directorySection) {
		sections.push(directorySection);
	}

	return `// Generated by Shovel - DO NOT EDIT
// This file provides typed overloads for self.databases.open() and self.directories.open()
${imports.join("\n")}

declare global {
${sections.join("\n")}
}

export {};
`;
}

/**
 * @deprecated Use generateStorageTypes instead
 */
export function generateDatabaseTypes(
	databases: DatabaseInfo[],
	outDir: string,
): string {
	return generateStorageTypes(databases, [], outDir);
}

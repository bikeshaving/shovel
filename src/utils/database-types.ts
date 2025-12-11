/**
 * Storage type generation utilities.
 *
 * Generates TypeScript declaration files with typed overloads for:
 * - DatabaseStorage.open() - returns typed Drizzle instances
 * - DirectoryStorage.open() - validates directory names at compile time
 *
 * Based on configurations in shovel.json.
 */

import {resolve, relative} from "path";
import type {DatabaseDialect} from "./config.js";
import {loadRawConfig} from "./config.js";

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
 * Discover databases from the project's shovel.json.
 *
 * @param projectRoot - Root directory of the project
 * @returns Array of discovered databases
 */
export function discoverDatabases(projectRoot: string): DatabaseInfo[] {
	const databases: DatabaseInfo[] = [];
	const config = loadRawConfig(projectRoot);

	if (config.databases) {
		for (const [name, dbConfig] of Object.entries(config.databases)) {
			if (dbConfig.schema) {
				databases.push({
					name,
					dialect: dbConfig.dialect,
					schemaPath: resolve(projectRoot, dbConfig.schema),
					packageDir: projectRoot,
				});
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
 * @param databases - Array of database info from discoverDatabases
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

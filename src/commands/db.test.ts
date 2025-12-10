import {test, expect, describe} from "bun:test";
import {resolveDatabase, generateDrizzleConfig, mapDialect} from "./db.js";
import type {ProcessedShovelConfig, DatabaseConfig} from "../utils/config.js";

// Helper to create a minimal config with databases
function makeConfig(
	databases: Record<string, DatabaseConfig>,
): ProcessedShovelConfig {
	return {
		databases,
	} as ProcessedShovelConfig;
}

describe("db commands", () => {
	describe("mapDialect", () => {
		test("maps postgresql to postgresql", () => {
			expect(mapDialect("postgresql")).toBe("postgresql");
		});

		test("maps mysql to mysql", () => {
			expect(mapDialect("mysql")).toBe("mysql");
		});

		test("maps sqlite to sqlite", () => {
			expect(mapDialect("sqlite")).toBe("sqlite");
		});

		test("maps bun-sqlite to sqlite", () => {
			expect(mapDialect("bun-sqlite")).toBe("sqlite");
		});

		test("maps libsql to turso", () => {
			expect(mapDialect("libsql")).toBe("turso");
		});

		test("maps d1 to sqlite", () => {
			expect(mapDialect("d1")).toBe("sqlite");
		});

		test("returns unknown dialects unchanged", () => {
			expect(mapDialect("unknown")).toBe("unknown");
		});
	});

	describe("resolveDatabase", () => {
		test("throws when no databases configured", () => {
			const config = makeConfig({});
			expect(() => resolveDatabase(undefined, config)).toThrow(
				"No databases configured",
			);
		});

		test("returns named database when specified", () => {
			const config = makeConfig({
				analytics: {
					dialect: "postgresql",
					url: "DATABASE_URL",
					schema: "./src/db/analytics.ts",
				},
			});

			const result = resolveDatabase("analytics", config);
			expect(result.name).toBe("analytics");
			expect(result.config.dialect).toBe("postgresql");
		});

		test("throws when named database not found", () => {
			const config = makeConfig({
				main: {
					dialect: "postgresql",
					url: "DATABASE_URL",
					schema: "./src/db/schema.ts",
				},
			});

			expect(() => resolveDatabase("analytics", config)).toThrow(
				'Database "analytics" not found',
			);
		});

		test("defaults to main when no name provided", () => {
			const config = makeConfig({
				main: {
					dialect: "postgresql",
					url: "DATABASE_URL",
					schema: "./src/db/schema.ts",
				},
				analytics: {
					dialect: "mysql",
					url: "MYSQL_URL",
					schema: "./src/db/analytics.ts",
				},
			});

			const result = resolveDatabase(undefined, config);
			expect(result.name).toBe("main");
		});

		test("defaults to first database when no main exists", () => {
			const config = makeConfig({
				analytics: {
					dialect: "postgresql",
					url: "DATABASE_URL",
					schema: "./src/db/analytics.ts",
				},
			});

			const result = resolveDatabase(undefined, config);
			expect(result.name).toBe("analytics");
		});
	});

	describe("generateDrizzleConfig", () => {
		test("generates config with env var url", () => {
			const dbConfig: DatabaseConfig = {
				dialect: "postgresql",
				url: "resolved-url-value", // processed config has resolved value
				schema: "./src/db/schema.ts",
			};

			// Raw URL is the env var expression
			const result = generateDrizzleConfig("main", dbConfig, "DATABASE_URL");

			expect(result).toContain('dialect: "postgresql"');
			expect(result).toContain('schema: "./src/db/schema.ts"');
			expect(result).toContain('out: "./migrations/main"');
			expect(result).toContain("process.env.DATABASE_URL");
		});

		test("generates config with literal url", () => {
			const dbConfig: DatabaseConfig = {
				dialect: "sqlite",
				url: "./data/app.db",
				schema: "./src/db/schema.ts",
			};

			const result = generateDrizzleConfig("main", dbConfig, "./data/app.db");

			expect(result).toContain('dialect: "sqlite"');
			expect(result).toContain('"./data/app.db"');
		});

		test("generates config with fallback expression", () => {
			const dbConfig: DatabaseConfig = {
				dialect: "postgresql",
				url: "postgres://localhost:5432/dev", // resolved value
				schema: "./src/db/schema.ts",
			};

			// Raw URL has fallback expression
			const result = generateDrizzleConfig(
				"main",
				dbConfig,
				"DATABASE_URL || postgres://localhost:5432/dev",
			);

			expect(result).toContain("process.env.DATABASE_URL");
			expect(result).toContain("postgres://localhost:5432/dev");
			expect(result).toContain("||");
		});

		test("maps dialect correctly", () => {
			const dbConfig: DatabaseConfig = {
				dialect: "libsql",
				url: "libsql://...",
				schema: "./src/db/schema.ts",
			};

			const result = generateDrizzleConfig("turso", dbConfig, "TURSO_URL");

			expect(result).toContain('dialect: "turso"');
			expect(result).toContain('out: "./migrations/turso"');
		});

		test("includes defineConfig import", () => {
			const dbConfig: DatabaseConfig = {
				dialect: "postgresql",
				url: "postgres://...",
				schema: "./src/db/schema.ts",
			};

			const result = generateDrizzleConfig("main", dbConfig, "DATABASE_URL");

			expect(result).toContain('import { defineConfig } from "drizzle-kit"');
			expect(result).toContain("export default defineConfig");
		});
	});
});

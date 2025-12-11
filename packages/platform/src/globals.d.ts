/// <reference lib="webworker" />

/**
 * Global type declarations for Shovel ServiceWorker environment.
 *
 * These types augment the global scope with Shovel-specific APIs
 * that are installed by ServiceWorkerGlobals.
 *
 * Usage: Include this file in your tsconfig.json "include" array
 * or reference it with /// <reference types="@b9g/platform/globals" />
 */

import type {Logger} from "@logtape/logtape";
import type {DirectoryStorage} from "@b9g/filesystem";

/**
 * Drizzle ORM instance type for dynamic database operations.
 *
 * This type uses `any` intentionally to support dynamic schema introspection
 * (e.g., admin panels) where the schema isn't known at compile time.
 *
 * For type-safe usage, cast to your specific Drizzle database type:
 * @example
 * ```typescript
 * import type {BunSQLiteDatabase} from "drizzle-orm/bun-sqlite";
 * const db = await self.databases.open("main") as BunSQLiteDatabase<typeof schema>;
 * ```
 */
export type DrizzleInstance = {
	query: Record<string, unknown>;
	select: (...args: any[]) => any;
	insert: (...args: any[]) => any;
	update: (...args: any[]) => any;
	delete: (...args: any[]) => any;
	transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
	[key: string]: unknown;
};

declare global {
	/**
	 * Logger storage API for accessing named loggers.
	 * @example const logger = self.loggers.get("app");
	 * @example const dbLogger = self.loggers.get("app", "db");
	 */
	interface LoggerStorage {
		get(...categories: string[]): Logger;
	}

	/**
	 * Database storage API for accessing named database instances.
	 *
	 * The base interface returns `Promise<unknown>`. When using `shovel build` or
	 * `shovel develop`, typed overloads are generated in `dist/server/shovel.d.ts`
	 * that provide full Drizzle type inference based on your shovel.json config.
	 *
	 * @example const db = await self.databases.open("main");
	 */
	interface DatabaseStorage {
		open(name: string): Promise<unknown>;
		has(name: string): boolean;
		keys(): string[];
		close(name: string): Promise<void>;
		closeAll(): Promise<void>;
	}

	/**
	 * Directory storage API for accessing named directories.
	 * @example const uploads = await directories.open("uploads");
	 */
	var directories: DirectoryStorage;

	/**
	 * Logger storage API for accessing named loggers.
	 * @example const logger = self.loggers.get("app");
	 * @example const dbLogger = self.loggers.get("app", "db");
	 */
	var loggers: LoggerStorage;

	/**
	 * Database storage API for accessing named database instances.
	 * @example const db = await self.databases.open("main");
	 */
	var databases: DatabaseStorage;

	/**
	 * Environment variables available via import.meta.env
	 * Works across all platforms (Node/Bun via esbuild shim, Cloudflare natively)
	 */
	interface ImportMetaEnv {
		readonly [key: string]: string | undefined;
	}

	interface ImportMeta {
		readonly env: ImportMetaEnv;
	}

	/**
	 * Augment WorkerGlobalScopeEventMap with ServiceWorker events.
	 *
	 * TypeScript's lib.webworker.d.ts declares `self` as `WorkerGlobalScope`, not
	 * `ServiceWorkerGlobalScope`. This means `self.addEventListener("fetch", ...)`
	 * doesn't know about FetchEvent. See: https://github.com/microsoft/TypeScript/issues/14877
	 *
	 * Rather than trying to redeclare `self` (which causes conflicts), we augment
	 * the base WorkerGlobalScopeEventMap to include ServiceWorker-specific events.
	 * This allows `self.addEventListener("fetch", (event) => ...)` to correctly
	 * infer `event` as `FetchEvent`.
	 */
	interface WorkerGlobalScopeEventMap {
		fetch: FetchEvent;
		install: ExtendableEvent;
		activate: ExtendableEvent;
		message: ExtendableMessageEvent;
		messageerror: MessageEvent;
	}
}

export {};

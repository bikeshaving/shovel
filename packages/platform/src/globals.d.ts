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

declare global {
	/**
	 * Logger storage API for accessing named loggers.
	 * @example const logger = self.loggers.get(["app"]);
	 * @example const dbLogger = self.loggers.get(["app", "db"]);
	 */
	interface LoggerStorage {
		get(categories: string[]): Logger;
	}

	/**
	 * Upgrade event passed to onUpgrade callback during database.open().
	 */
	interface DatabaseUpgradeEvent {
		/** The database being upgraded */
		db: unknown;
		/** Previous database version (0 if new) */
		oldVersion: number;
		/** Target version being opened */
		newVersion: number;
		/** Register a promise that must complete before open() resolves */
		waitUntil(promise: Promise<unknown>): void;
	}

	/**
	 * Database storage API for accessing named database instances.
	 *
	 * @example
	 * // In activate - open with migrations
	 * await self.databases.open("main", 2, (e) => {
	 *   e.waitUntil(runMigrations(e));
	 * });
	 *
	 * // In fetch - get opened database (sync)
	 * const db = self.databases.get("main");
	 */
	interface DatabaseStorage {
		/** Open a database at a specific version, running migrations if needed */
		open(
			name: string,
			version: number,
			onUpgrade?: (event: DatabaseUpgradeEvent) => void,
		): Promise<unknown>;
		/** Get an already-opened database (throws if not opened) */
		get(name: string): unknown;
		/** Close a specific database */
		close(name: string): Promise<void>;
		/** Close all databases */
		closeAll(): Promise<void>;
	}

	/**
	 * Directory storage API for accessing named directories.
	 * @example const uploads = await directories.open("uploads");
	 */
	var directories: DirectoryStorage;

	/**
	 * Logger storage API for accessing named loggers.
	 * @example const logger = self.loggers.get(["app"]);
	 * @example const dbLogger = self.loggers.get(["app", "db"]);
	 */
	var loggers: LoggerStorage;

	/**
	 * Database storage API for accessing named database instances.
	 * @example const db = self.databases.get("main");
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

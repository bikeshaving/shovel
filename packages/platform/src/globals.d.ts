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
	 * WebSocket client accessible from websocketmessage/websocketclose events.
	 * Created by FetchEvent.upgradeWebSocket().
	 */
	interface WebSocketClient extends Client {
		/** Arbitrary user data attached during upgradeWebSocket() */
		readonly data: any;
		/** Send a message to the connected client */
		send(data: string | ArrayBuffer): void;
		/** Close the WebSocket connection */
		close(code?: number, reason?: string): void;
	}

	/**
	 * Event dispatched when a WebSocket message is received.
	 */
	interface WebSocketMessageEvent extends ExtendableEvent {
		/** The WebSocket client that sent the message */
		readonly source: WebSocketClient;
		/** The message data (string or ArrayBuffer) */
		readonly data: string | ArrayBuffer;
	}

	/**
	 * Event dispatched when a WebSocket connection closes.
	 */
	interface WebSocketCloseEvent extends ExtendableEvent {
		/** The WebSocket client that disconnected */
		readonly source: WebSocketClient;
		/** The close code */
		readonly code: number;
		/** The close reason */
		readonly reason: string;
		/** Whether the close was clean */
		readonly wasClean: boolean;
	}

	/**
	 * Augment FetchEvent with WebSocket upgrade support.
	 */
	interface FetchEvent {
		/**
		 * Upgrade this request to a WebSocket connection.
		 * Returns a WebSocketClient for sending messages.
		 * No respondWith() call is needed — the upgrade replaces the HTTP response.
		 */
		upgradeWebSocket(options?: {data?: any}): WebSocketClient;
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
		websocketmessage: WebSocketMessageEvent;
		websocketclose: WebSocketCloseEvent;
	}

	/**
	 * When both DOM and WebWorker libs are included (universal/isomorphic code),
	 * the DOM lib's addEventListener overload on Window takes priority and infers
	 * events as `Event` instead of `FetchEvent`/`ExtendableEvent`. This augmentation
	 * adds a ServiceWorker-aware overload to Window so inference works in both contexts.
	 */
	interface Window {
		addEventListener<K extends keyof WorkerGlobalScopeEventMap>(
			type: K,
			listener: (this: Window, ev: WorkerGlobalScopeEventMap[K]) => any,
			options?: boolean | AddEventListenerOptions,
		): void;
	}
}

export {};

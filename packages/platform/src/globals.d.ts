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
	 * Server-side handle to a WebSocket peer connected to the ServiceWorker.
	 * Returned by `FetchEvent.upgradeWebSocket()` and available as `source` on
	 * `WebSocketMessageEvent`.
	 *
	 * A stable handle to an accepted WebSocket connection, with
	 * subscribe/unsubscribe semantics for runtime-mediated BroadcastChannel
	 * fanout.
	 *
	 * References to instances do not survive hibernation — use the handle only
	 * within the current event handler. To interact with a connection from a
	 * different handler or context, publish on a channel the connection has
	 * subscribed to.
	 *
	 * @example
	 * self.addEventListener("fetch", async (event) => {
	 *   if (event.request.headers.get("Upgrade") === "websocket") {
	 *     const userId = await authenticate(event.request);
	 *     const ws = event.upgradeWebSocket();
	 *     ws.subscribe(`user:${userId}`);
	 *     ws.send(JSON.stringify({type: "welcome", id: ws.id}));
	 *     return;
	 *   }
	 *   event.respondWith(new Response("..."));
	 * });
	 */
	interface WebSocketConnection {
		/**
		 * Stable, runtime-assigned connection id. Persists across hibernation.
		 * Use to correlate with `websocketclose`.
		 */
		readonly id: string;
		/** Send a message on this connection. */
		send(data: string | ArrayBuffer): void;
		/** Close this connection. */
		close(code?: number, reason?: string): void;
		/**
		 * Subscribe this connection to a `BroadcastChannel` by name. Any
		 * message published on that channel is delivered as `send()` on this
		 * connection. Survives hibernation.
		 */
		subscribe(channel: string): void;
		/** Remove a subscription. */
		unsubscribe(channel: string): void;
	}

	/**
	 * FetchEvent augmentation for WebSocket upgrades.
	 *
	 * Calling `upgradeWebSocket()` marks the fetch event as handled (no
	 * `respondWith` needed) and initiates the WebSocket handshake. Subsequent
	 * messages and close events for this connection dispatch to the
	 * `websocketmessage` / `websocketclose` module-scope handlers.
	 */
	interface FetchEvent {
		/**
		 * Upgrade this request to a WebSocket connection. Must be called
		 * during the synchronous portion of the fetch handler (before any
		 * `await`). Throws if the request does not carry `Upgrade: websocket`.
		 */
		upgradeWebSocket(): WebSocketConnection;
	}

	/**
	 * Fired when a message is received on an accepted WebSocket connection.
	 * `source` is the connection that sent the message; call `source.send()`
	 * to reply, or publish on a channel the connection subscribes to.
	 *
	 * Follows the `ExtendableMessageEvent.source` pattern.
	 *
	 * @example
	 * self.addEventListener("websocketmessage", (event) => {
	 *   event.source.send(`echo: ${event.data}`);
	 * });
	 */
	interface WebSocketMessageEvent extends ExtendableEvent {
		/** The connection that sent this message. */
		readonly source: WebSocketConnection;
		/** The message payload. */
		readonly data: string | ArrayBuffer;
	}

	/**
	 * Fired when an accepted WebSocket connection closes. After this event,
	 * all subscriptions for the connection are removed and the id is released.
	 *
	 * @example
	 * self.addEventListener("websocketclose", async (event) => {
	 *   await storage.srem("room:lobby", event.id);
	 * });
	 */
	interface WebSocketCloseEvent extends ExtendableEvent {
		/** The closed connection's stable id. */
		readonly id: string;
		/** Close code, per RFC 6455. */
		readonly code: number;
		/** Close reason. */
		readonly reason: string;
		/** Whether the closing handshake completed cleanly. */
		readonly wasClean: boolean;
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

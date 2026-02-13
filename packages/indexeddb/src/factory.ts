/**
 * IDBFactory implementation — the value of self.indexedDB.
 */

import type {IDBBackend} from "./backend.js";
import {IDBDatabase} from "./database.js";
import {IDBObjectStore} from "./object-store.js";
import {IDBTransaction} from "./transaction.js";
import {IDBOpenDBRequest} from "./request.js";
import {IDBVersionChangeEvent} from "./events.js";
import {VersionError} from "./errors.js";
import {validateKeyPath, encodeKey, validateKey, compareKeys} from "./key.js";
import type {TransactionMode} from "./types.js";
import {scheduleTask} from "./task.js";
import {TransactionScheduler} from "./scheduler.js";

interface PendingRequest {
	name: string;
	version: number | undefined;
	request: IDBOpenDBRequest;
	isDelete: boolean;
	onComplete?: () => void;
}

export class IDBFactory {
	#backend: IDBBackend;
	/** Open connections per database name */
	#connections: Map<string, Set<IDBDatabase>>;
	/** Blocked requests waiting for connections to close */
	#pendingRequests: PendingRequest[];
	/** Per-database transaction schedulers (shared across connections) */
	#schedulers: Map<string, TransactionScheduler> = new Map();
	/** Per-database FIFO queue for open/delete requests (spec §2.7) */
	#fifoQueues: Map<string, PendingRequest[]> = new Map();

	constructor(backend: IDBBackend) {
		this.#backend = backend;
		this.#connections = new Map();
		this.#pendingRequests = [];
	}

	#getScheduler(name: string): TransactionScheduler {
		let scheduler = this.#schedulers.get(name);
		if (!scheduler) {
			scheduler = new TransactionScheduler();
			this.#schedulers.set(name, scheduler);
		}
		return scheduler;
	}

	#enqueueFIFO(entry: PendingRequest): void {
		let queue = this.#fifoQueues.get(entry.name);
		if (!queue) {
			queue = [];
			this.#fifoQueues.set(entry.name, queue);
		}
		queue.push(entry);
		if (queue.length === 1) {
			this.#startNextFIFO(entry.name);
		}
	}

	#startNextFIFO(name: string): void {
		const queue = this.#fifoQueues.get(name);
		if (!queue || queue.length === 0) {
			this.#fifoQueues.delete(name);
			return;
		}
		const entry = queue[0];

		const onComplete = () => {
			queue.shift();
			if (queue.length > 0) {
				// Use queueMicrotask (not scheduleTask) to avoid growing the
				// setImmediate chain.  Bun drains ALL setImmediate waves before
				// timers, so each extra setImmediate delays setTimeout(0) callbacks
				// across the entire process — causing timeouts when many FIFO
				// queues run concurrently.
				queueMicrotask(() => this.#startNextFIFO(name));
			} else {
				this.#fifoQueues.delete(name);
			}
		};

		scheduleTask(() => {
			try {
				if (entry.isDelete) {
					this.#processDelete(name, entry.request, onComplete);
				} else {
					this.#processOpen(
						name,
						entry.version,
						entry.request,
						onComplete,
					);
				}
			} catch (error) {
				entry.request._reject(
					error instanceof DOMException
						? error
						: new DOMException(String(error), "UnknownError"),
				);
				onComplete();
			}
		});
	}

	/**
	 * Open a database.
	 */
	open(name: string, version?: number): IDBOpenDBRequest {
		// Web IDL [EnforceRange] unsigned long long validation
		if (version !== undefined) {
			// Convert to number (handles objects, strings, etc.)
			const v = Number(version);
			if (!Number.isFinite(v) || v < 1 || v > Number.MAX_SAFE_INTEGER) {
				throw new TypeError(
					`Failed to execute 'open' on 'IDBFactory': The optional version provided is not a valid integer version.`,
				);
			}
			// Floor the version (Web IDL truncates non-integers)
			version = Math.floor(v);
		}

		const request = new IDBOpenDBRequest();
		this.#enqueueFIFO({name, version, request, isDelete: false});
		return request;
	}

	/**
	 * Delete a database.
	 */
	deleteDatabase(name: string): IDBOpenDBRequest {
		const request = new IDBOpenDBRequest();
		this.#enqueueFIFO({
			name,
			version: undefined,
			request,
			isDelete: true,
		});
		return request;
	}

	/**
	 * List all databases.
	 */
	databases(): Promise<Array<{name: string; version: number}>> {
		return Promise.resolve(this.#backend.databases());
	}

	/**
	 * Compare two keys.
	 */
	cmp(first: any, second: any): number {
		if (arguments.length < 2) {
			throw new TypeError(
				"Failed to execute 'cmp' on 'IDBFactory': 2 arguments required, but only " +
					arguments.length +
					" present.",
			);
		}
		const a = encodeKey(validateKey(first));
		const b = encodeKey(validateKey(second));
		return compareKeys(a, b);
	}

	// ---- Private: Connection blocking ----

	#registerConnection(name: string, db: IDBDatabase): void {
		if (!this.#connections.has(name)) {
			this.#connections.set(name, new Set());
		}
		this.#connections.get(name)!.add(db);
		db._setOnClose(() => {
			this.#connections.get(name)?.delete(db);
			queueMicrotask(() => this.#processPendingRequests(name));
		});
	}

	#unregisterConnection(name: string, db: IDBDatabase): void {
		this.#connections.get(name)?.delete(db);
	}

	#hasOpenConnections(name: string): boolean {
		const conns = this.#connections.get(name);
		if (!conns) return false;
		for (const c of conns) {
			if (!c._closed) return true;
		}
		return false;
	}

	/** Check for blocking connections, fire versionchange/blocked events.
	 *  Returns true if the request was blocked and queued. */
	#checkBlocking(
		name: string,
		oldVersion: number,
		newVersion: number | null,
		request: IDBOpenDBRequest,
		pendingEntry: PendingRequest,
	): boolean {
		const conns = this.#connections.get(name);
		if (!conns || conns.size === 0) return false;

		// Fire versionchange on all open connections
		for (const conn of [...conns]) {
			if (!conn._closed) {
				conn.dispatchEvent(
					new IDBVersionChangeEvent("versionchange", {
						oldVersion: conn.version,
						newVersion,
					}),
				);
			}
		}

		// Check if all connections are now closed (handlers may have called close())
		if (!this.#hasOpenConnections(name)) return false;

		// Still blocked — queue for later processing, fire "blocked" asynchronously
		// so EventWatcher listeners have a chance to register after awaiting versionchange.
		// Use queueMicrotask (not scheduleTask/setImmediate) — the blocked event
		// must fire before setTimeout(0) close callbacks, and microtasks always
		// run before both setImmediate and timer phases.  This also avoids growing
		// the setImmediate chain that starves timers in Bun.
		this.#pendingRequests.push(pendingEntry);
		queueMicrotask(() => {
			// Only fire if the request hasn't been processed yet
			// (e.g. connections may have closed before this fires)
			if (this.#pendingRequests.indexOf(pendingEntry) >= 0) {
				request._fireBlocked(oldVersion, newVersion);
			}
		});
		return true;
	}

	#processPendingRequests(name: string): void {
		if (this.#hasOpenConnections(name)) return;

		const idx = this.#pendingRequests.findIndex((r) => r.name === name);
		if (idx < 0) return;
		const pending = this.#pendingRequests.splice(idx, 1)[0];

		try {
			if (pending.isDelete) {
				this.#doDelete(
					pending.name,
					pending.request,
					pending.onComplete,
				);
			} else {
				this.#doOpen(
					pending.name,
					pending.version,
					pending.request,
					pending.onComplete,
				);
			}
		} catch (error) {
			pending.request._reject(
				error instanceof DOMException
					? error
					: new DOMException(String(error), "UnknownError"),
			);
			pending.onComplete?.();
		}
	}

	#processOpen(
		name: string,
		version: number | undefined,
		request: IDBOpenDBRequest,
		onComplete?: () => void,
	): void {
		// Check if a version change is needed
		const existingDbs = this.#backend.databases();
		const existing = existingDbs.find((db) => db.name === name);
		const oldVersion = existing?.version ?? 0;
		const requestedVersion = version ?? (oldVersion || 1);

		if (requestedVersion > oldVersion) {
			// Version change needed — check for blocking connections
			const blocked = this.#checkBlocking(
				name,
				oldVersion,
				requestedVersion,
				request,
				{name, version, request, isDelete: false, onComplete},
			);
			if (blocked) return;
		}

		this.#doOpen(name, version, request, onComplete);
	}

	#processDelete(
		name: string,
		request: IDBOpenDBRequest,
		onComplete?: () => void,
	): void {
		const existing = this.#backend.databases().find((db) => db.name === name);
		const oldVersion = existing?.version ?? 0;

		const blocked = this.#checkBlocking(name, oldVersion, null, request, {
			name,
			version: undefined,
			request,
			isDelete: true,
			onComplete,
		});
		if (blocked) return;

		this.#doDelete(name, request, onComplete);
	}

	#doDelete(
		name: string,
		request: IDBOpenDBRequest,
		onComplete?: () => void,
	): void {
		const existing = this.#backend.databases().find((db) => db.name === name);
		const oldVersion = existing?.version ?? 0;
		this.#backend.deleteDatabase(name);
		request._resolveWithVersionChange(undefined, oldVersion);
		onComplete?.();
	}

	// ---- Private: Open implementation ----

	#doOpen(
		name: string,
		version: number | undefined,
		request: IDBOpenDBRequest,
		onComplete?: () => void,
	): void {
		// Check if database exists and get its current version
		const existingDbs = this.#backend.databases();
		const existing = existingDbs.find((db) => db.name === name);
		const oldVersion = existing?.version ?? 0;

		// Default version
		const requestedVersion = version ?? (oldVersion || 1);

		if (requestedVersion < oldVersion) {
			throw VersionError(
				`Requested version (${requestedVersion}) is less than existing version (${oldVersion})`,
			);
		}

		// Open the backend connection (does NOT set version yet)
		const connection = this.#backend.open(name, requestedVersion);
		const scheduler = this.#getScheduler(name);
		const db = new IDBDatabase(name, requestedVersion, connection, scheduler);

		// Track connection for blocking checks
		this.#registerConnection(name, db);

		if (requestedVersion > oldVersion) {
			// Need to run upgrade
			const storeNames = Array.from(
				connection.getMetadata().objectStores.keys(),
			);
			// Create transaction BEFORE setting version so the snapshot
			// captures the OLD version for correct rollback on abort.
			const backendTx = connection.beginTransaction(
				storeNames,
				"versionchange",
			);
			// NOW set the version on the backend
			connection.setVersion(requestedVersion);
			const transaction = new IDBTransaction(
				db,
				storeNames,
				"versionchange" as TransactionMode,
				backendTx,
			);
			// Set parent for event bubbling: transaction → database
			transaction._parent = db;

			// Track stores/indexes created and deleted during upgrade for abort revert
			const createdStores = new Set<string>();
			const deletedStores = new Set<string>();
			// Track all IDBObjectStore instances to mark as deleted on abort
			const storeInstances: IDBObjectStore[] = [];
			// Snapshot initial index names per store before upgrade
			const initialIndexNames = new Map<string, string[]>();
			const meta = connection.getMetadata();
			for (const [sName, indexes] of meta.indexes) {
				initialIndexNames.set(
					sName,
					indexes.map((i) => i.name),
				);
			}

			// The transaction's objectStore() needs to work during upgrade,
			// and createObjectStore needs to use this transaction
			const originalCreateObjectStore = db.createObjectStore.bind(db);
			db.createObjectStore = (
				rawStoreName: string | any,
				options?: IDBObjectStoreParameters,
			) => {
				// Spec order: upgrade tx null → InvalidStateError, then active check
				if (!db._upgradeTx) {
					throw new DOMException(
						"The database is not running a version change transaction",
						"InvalidStateError",
					);
				}
				if (!transaction._active) {
					throw new DOMException(
						"The transaction is not active",
						"TransactionInactiveError",
					);
				}
				// Web IDL: stringify the name
				const storeName = String(rawStoreName);
				if (options?.keyPath !== undefined && options?.keyPath !== null) {
					validateKeyPath(options.keyPath);
				}
				// Spec: throw ConstraintError if store already exists
				if (db.objectStoreNames.contains(storeName)) {
					throw new DOMException(
						`Object store "${storeName}" already exists`,
						"ConstraintError",
					);
				}
				// Normalize keyPath: stringify array elements per Web IDL
				let keyPath: string | string[] | null = options?.keyPath ?? null;
				if (Array.isArray(keyPath)) {
					keyPath = keyPath.map(String);
				}
				const autoIncrement = options?.autoIncrement ?? false;
				// Spec: autoIncrement with empty string keyPath is invalid
				if (autoIncrement && keyPath === "") {
					throw new DOMException(
						"autoIncrement is not allowed with an empty keyPath",
						"InvalidAccessError",
					);
				}
				// Spec: autoIncrement with array keyPath is invalid
				if (autoIncrement && Array.isArray(keyPath)) {
					throw new DOMException(
						"autoIncrement is not allowed with an array keyPath",
						"InvalidAccessError",
					);
				}
				const meta = {
					name: storeName,
					keyPath,
					autoIncrement,
				};
				backendTx.createObjectStore(meta);
				db._refreshStoreNames();
				// Update transaction scope to include new store
				if (!transaction._scope.includes(storeName)) {
					transaction._scope.push(storeName);
				}
				createdStores.add(storeName);
				deletedStores.delete(storeName);
				const store = new IDBObjectStore(transaction, meta);
				storeInstances.push(store);
				return store;
			};

			const originalDeleteObjectStore = db.deleteObjectStore.bind(db);
			db.deleteObjectStore = (storeName: string) => {
				// Spec order: upgrade tx null → InvalidStateError, then active check
				if (!db._upgradeTx) {
					throw new DOMException(
						"The database is not running a version change transaction",
						"InvalidStateError",
					);
				}
				if (!transaction._active) {
					throw new DOMException(
						"The transaction is not active",
						"TransactionInactiveError",
					);
				}
				// Spec: throw NotFoundError if store doesn't exist
				if (!db.objectStoreNames.contains(storeName)) {
					throw new DOMException(
						`Object store "${storeName}" not found`,
						"NotFoundError",
					);
				}
				// Mark all instances of this store as deleted,
				// clear indexNames, and mark index instances as deleted
				for (const inst of storeInstances) {
					if (inst.name === storeName) {
						inst._deleted = true;
						inst._indexNames.length = 0;
						for (const idx of inst._indexInstances) {
							idx._deleted = true;
						}
					}
				}
				backendTx.deleteObjectStore(storeName);
				db._refreshStoreNames();
				const idx = transaction._scope.indexOf(storeName);
				if (idx >= 0) {
					transaction._scope.splice(idx, 1);
				}
				if (!createdStores.has(storeName)) {
					deletedStores.add(storeName);
				}
				createdStores.delete(storeName);
			};

			// Wrap transaction.objectStore to track instances for abort revert
			const origObjectStore = transaction.objectStore.bind(transaction);
			transaction.objectStore = (storeName: string) => {
				const store = origObjectStore(storeName);
				storeInstances.push(store);
				return store;
			};

			// Set the request result early so it's accessible in upgradeneeded
			// (IDB spec says result is available during upgradeneeded)
			(request as any)._resolveWithoutEvent(db);

			// Synchronous metadata revert — runs during abort() BEFORE
			// the async abort event fires.  Ensures db.objectStoreNames,
			// db.version, store._deleted etc. are correct immediately
			// after abort() returns.
			transaction._onSyncAbort = () => {
				for (const inst of storeInstances) {
					if (createdStores.has(inst.name)) {
						inst._deleted = true;
						inst._indexNames.length = 0;
						for (const idx of inst._indexInstances) {
							idx._deleted = true;
						}
					} else if (deletedStores.has(inst.name)) {
						inst._deleted = false;
						for (const idx of inst._indexInstances) {
							idx._deleted = false;
						}
						const initial = initialIndexNames.get(inst.name) || [];
						inst._indexNames.length = 0;
						inst._indexNames.push(...initial);
					} else {
						const initial = initialIndexNames.get(inst.name) || [];
						for (const idx of inst._indexInstances) {
							if (!initial.includes(idx.name)) {
								idx._deleted = true;
							} else if (!inst._indexNames.includes(idx.name)) {
								idx._deleted = false;
							}
						}
						inst._indexNames.length = 0;
						inst._indexNames.push(...initial);
					}
				}

				// Revert scope to original store names
				transaction._scope.length = 0;
				transaction._scope.push(...storeNames);
				for (const s of deletedStores) {
					if (!transaction._scope.includes(s)) {
						transaction._scope.push(s);
					}
				}
				for (const s of createdStores) {
					const idx = transaction._scope.indexOf(s);
					if (idx >= 0) transaction._scope.splice(idx, 1);
				}

				db._refreshStoreNames();
				db._setVersion(oldVersion);

				// Unregister connection and clean up database synchronously
				// so databases() reflects the revert immediately.
				this.#unregisterConnection(name, db);
				if (oldVersion === 0) {
					try {
						this.#backend.deleteDatabase(name);
					} catch (_error) {
						/* ignored */
					}
				}
			};

			// Abort event listener — handles async cleanup.  The abort
			// event for versionchange fires as a macrotask (scheduleTask
			// in transaction.abort()), so db._upgradeTx and
			// request.transaction remain set through abort() return and
			// microtasks, matching spec timing.
			transaction.addEventListener("abort", () => {
				// Clear so abort-handler code sees InvalidStateError
				// from createObjectStore (not TransactionInactiveError).
				db._upgradeTx = null;

				const abortError = new DOMException(
					"Version change transaction was aborted",
					"AbortError",
				);
				// Defer clearing request.transaction so other abort
				// listeners still see it during dispatch.
				queueMicrotask(() => {
					request._setTransaction(null);
					db.createObjectStore = originalCreateObjectStore;
					db.deleteObjectStore = originalDeleteObjectStore;
					request._reject(abortError);
					onComplete?.();
				});
			});

			// Register early complete listener BEFORE upgradeneeded so that
			// db._upgradeTx is cleared before test-registered listeners fire.
			// Spec: upgrade transaction reference is cleared before complete event.
			transaction.addEventListener("complete", () => {
				db._upgradeTx = null;
			});

			// Fire upgradeneeded
			db._upgradeTx = transaction;
			request._setTransaction(transaction);
			const upgradeHadError =
				request._fireUpgradeNeeded(oldVersion, requestedVersion);

			// Register complete listener AFTER upgradeneeded so that handlers
			// registered by the upgradeneeded callback fire before this one.
			// This ensures oncomplete fires before onsuccess per spec.
			transaction.addEventListener("complete", () => {
				db.createObjectStore = originalCreateObjectStore;
				db.deleteObjectStore = originalDeleteObjectStore;
				db._refreshStoreNames();
				request._setTransaction(null);
				// If db.close() was called during upgrade, fire error instead of success
				if (db._closed) {
					request._reject(
						new DOMException(
							"The connection was closed during upgrade",
							"AbortError",
						),
					);
				} else {
					request._resolve(db);
				}
				onComplete?.();
			});

			// If an exception was thrown during upgradeneeded, abort the transaction
			if (upgradeHadError && !transaction._finished) {
				transaction.abort();
			}

			// Schedule auto-commit (only if not already aborted/committed)
			if (!transaction._finished) {
				// Spec: deactivate after the upgradeneeded task's microtask checkpoint
				transaction._scheduleDeactivation();
				transaction._scheduleAutoCommit();
			}
		} else {
			// No upgrade needed — ensure version is set on the backend
			connection.setVersion(requestedVersion);
			request._resolve(db);
			onComplete?.();
		}
	}
}

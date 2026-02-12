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

interface PendingRequest {
	name: string;
	version: number | undefined;
	request: IDBOpenDBRequest;
	isDelete: boolean;
}

export class IDBFactory {
	#backend: IDBBackend;
	/** Open connections per database name */
	#connections: Map<string, Set<IDBDatabase>>;
	/** Blocked requests waiting for connections to close */
	#pendingRequests: PendingRequest[];

	constructor(backend: IDBBackend) {
		this.#backend = backend;
		this.#connections = new Map();
		this.#pendingRequests = [];
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

		scheduleTask(() => {
			try {
				this.#processOpen(name, version, request);
			} catch (error) {
				request._reject(
					error instanceof DOMException
						? error
						: new DOMException(String(error), "UnknownError"),
				);
			}
		});

		return request;
	}

	/**
	 * Delete a database.
	 */
	deleteDatabase(name: string): IDBOpenDBRequest {
		const request = new IDBOpenDBRequest();

		scheduleTask(() => {
			try {
				this.#processDelete(name, request);
			} catch (error) {
				request._reject(
					error instanceof DOMException
						? error
						: new DOMException(String(error), "UnknownError"),
				);
			}
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

		// Still blocked — fire "blocked" event on the request
		request._fireBlocked(oldVersion, newVersion);

		// Check again — blocked handler may have closed connections
		if (!this.#hasOpenConnections(name)) return false;

		// Still blocked — queue for later processing
		this.#pendingRequests.push(pendingEntry);
		return true;
	}

	#processPendingRequests(name: string): void {
		if (this.#hasOpenConnections(name)) return;

		const idx = this.#pendingRequests.findIndex((r) => r.name === name);
		if (idx < 0) return;
		const pending = this.#pendingRequests.splice(idx, 1)[0];

		try {
			if (pending.isDelete) {
				this.#doDelete(pending.name, pending.request);
				// Delete doesn't create connections — process next
				this.#processPendingRequests(name);
			} else {
				this.#doOpen(pending.name, pending.version, pending.request);
			}
		} catch (error) {
			pending.request._reject(
				error instanceof DOMException
					? error
					: new DOMException(String(error), "UnknownError"),
			);
		}
	}

	#processOpen(
		name: string,
		version: number | undefined,
		request: IDBOpenDBRequest,
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
				{name, version, request, isDelete: false},
			);
			if (blocked) return;
		}

		this.#doOpen(name, version, request);
	}

	#processDelete(name: string, request: IDBOpenDBRequest): void {
		const existing = this.#backend.databases().find((db) => db.name === name);
		const oldVersion = existing?.version ?? 0;

		const blocked = this.#checkBlocking(name, oldVersion, null, request, {
			name,
			version: undefined,
			request,
			isDelete: true,
		});
		if (blocked) return;

		this.#doDelete(name, request);
	}

	#doDelete(name: string, request: IDBOpenDBRequest): void {
		const existing = this.#backend.databases().find((db) => db.name === name);
		const oldVersion = existing?.version ?? 0;
		this.#backend.deleteDatabase(name);
		request._resolveWithVersionChange(undefined, oldVersion);
	}

	// ---- Private: Open implementation ----

	#doOpen(
		name: string,
		version: number | undefined,
		request: IDBOpenDBRequest,
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
		const db = new IDBDatabase(name, requestedVersion, connection);

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

			// Track whether we're still inside upgradeneeded dispatch.
			// If abort happens during upgradeneeded, defer the reject to after
			// the handler returns (same microtask — databases() sees consistent
			// state). If abort happens later (async), use queueMicrotask.
			let insideUpgrade = true;
			let pendingRejectError: DOMException | null = null;

			// Register abort listener BEFORE firing upgradeneeded, because the
			// handler may call transaction.abort() synchronously.
			transaction.addEventListener("abort", () => {
				if (insideUpgrade) {
					// Synchronous abort (txn.abort() during upgradeneeded):
					// defer clearing _upgradeTx so code after abort() returns
					// sees TransactionInactiveError (not InvalidStateError).
					queueMicrotask(() => {
						db._upgradeTx = null;
					});
				} else {
					// Async abort (ConstraintError, etc.): clear immediately
					// so abort event listeners see InvalidStateError.
					db._upgradeTx = null;
				}
				// Revert metadata: created stores → mark as deleted
				for (const inst of storeInstances) {
					if (createdStores.has(inst.name)) {
						inst._deleted = true;
						// All indexes on created stores are also deleted
						inst._indexNames.length = 0;
						for (const idx of inst._indexInstances) {
							idx._deleted = true;
						}
					} else if (deletedStores.has(inst.name)) {
						// Deleted stores → unmark as deleted
						inst._deleted = false;
						// Restore indexes that were on the store before deletion
						for (const idx of inst._indexInstances) {
							idx._deleted = false;
						}
						// Restore indexNames to initial state
						const initial = initialIndexNames.get(inst.name) || [];
						inst._indexNames.length = 0;
						inst._indexNames.push(...initial);
					} else {
						// Existing store that wasn't created or deleted as a whole
						// Determine which indexes were created/deleted
						const initial = initialIndexNames.get(inst.name) || [];
						for (const idx of inst._indexInstances) {
							if (!initial.includes(idx.name)) {
								// This index was created during the upgrade → mark deleted
								idx._deleted = true;
							} else if (!inst._indexNames.includes(idx.name)) {
								// This index was deleted during the upgrade → unmark
								idx._deleted = false;
							}
						}
						// Restore indexNames to initial state
						inst._indexNames.length = 0;
						inst._indexNames.push(...initial);
					}
				}

				// Revert scope to original store names
				transaction._scope.length = 0;
				transaction._scope.push(...storeNames);
				// Add back deleted stores, remove created stores
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
				// Unregister the connection so it doesn't block future operations
				this.#unregisterConnection(name, db);
				// If this was the initial creation, clean up the database
				if (oldVersion === 0) {
					try {
						this.#backend.deleteDatabase(name);
					} catch (_error) {
						/* ignored */
					}
				}
				// Don't null out request.transaction here — other abort listeners
				// registered by the test may still need to read it. Clean up after
				// the abort event has fully dispatched.
				const abortError = new DOMException(
					"Version change transaction was aborted",
					"AbortError",
				);
				if (insideUpgrade) {
					// Abort during upgradeneeded — defer to after handler returns
					request._setTransaction(null);
					pendingRejectError = abortError;
				} else {
					// Abort after upgradeneeded (async) — defer cleanup via microtask
					// so abort event listeners see request.transaction during dispatch
					queueMicrotask(() => {
						request._setTransaction(null);
						db.createObjectStore = originalCreateObjectStore;
						db.deleteObjectStore = originalDeleteObjectStore;
						request._reject(abortError);
					});
				}
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
			});

			// If an exception was thrown during upgradeneeded, abort the transaction
			if (upgradeHadError && !transaction._finished) {
				transaction.abort();
			}

			// No longer inside upgrade dispatch — future aborts use queueMicrotask
			insideUpgrade = false;

			// Fire deferred reject AFTER upgradeneeded handler has returned.
			// The handler has had a chance to call t.done() or set up error
			// handlers. Firing here (same microtask as #doOpen) ensures
			// databases() sees consistent state (no other opens have run yet).
			if (pendingRejectError) {
				db.createObjectStore = originalCreateObjectStore;
				db.deleteObjectStore = originalDeleteObjectStore;
				request._reject(pendingRejectError);
				return;
			}

			// Schedule auto-commit (only if not already aborted/committed)
			if (!transaction._finished) {
				transaction._scheduleAutoCommit();
			}
		} else {
			// No upgrade needed — ensure version is set on the backend
			connection.setVersion(requestedVersion);
			request._resolve(db);
		}
	}
}

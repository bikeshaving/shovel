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
import {TransactionScheduler} from "./scheduler.js";
import {
	kResolve,
	kReject,
	kSetTransaction,
	kResolveWithoutEvent,
	kResolveWithVersionChange,
	kFireUpgradeNeeded,
	kFireBlocked,
	kUpgradeTx,
	kClosed,
	kFinishClose,
	kRefreshStoreNames,
	kSetVersion,
	kSetOnClose,
	kParent,
	kScope,
	kActive,
	kFinished,
	kOnSyncAbort,
	kScheduleAutoCommit,
	kScheduleDeactivation,
	kDeleted,
	kIndexNames,
	kIndexInstances,
} from "./symbols.js";

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
	#schedulers: Map<string, TransactionScheduler>;
	/** Per-database FIFO queue for open/delete requests (spec §2.7) */
	#fifoQueues: Map<string, PendingRequest[]>;

	constructor(backend: IDBBackend) {
		this.#backend = backend;
		this.#connections = new Map();
		this.#pendingRequests = [];
		this.#schedulers = new Map();
		this.#fifoQueues = new Map();
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
				// Use queueMicrotask (not setTimeout) so the next FIFO entry
				// starts promptly within the same microtask checkpoint.
				queueMicrotask(() => this.#startNextFIFO(name));
			} else {
				this.#fifoQueues.delete(name);
			}
		};

		setTimeout(async () => {
			try {
				if (entry.isDelete) {
					this.#processDelete(name, entry.request, onComplete);
				} else {
					await this.#processOpen(
						name,
						entry.version,
						entry.request,
						onComplete,
					);
				}
			} catch (error) {
				entry.request[kReject](
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
		db[kSetOnClose](() => {
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
			if (!c[kClosed]) return true;
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
			if (!conn[kClosed]) {
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
		// Use queueMicrotask — the blocked event must fire before close
		// callbacks, and microtasks always run before timer callbacks.
		this.#pendingRequests.push(pendingEntry);
		queueMicrotask(() => {
			// Only fire if the request hasn't been processed yet
			// (e.g. connections may have closed before this fires)
			if (this.#pendingRequests.indexOf(pendingEntry) >= 0) {
				request[kFireBlocked](oldVersion, newVersion);
			}
		});
		return true;
	}

	async #processPendingRequests(name: string): Promise<void> {
		if (this.#hasOpenConnections(name)) return;

		const idx = this.#pendingRequests.findIndex((r) => r.name === name);
		if (idx < 0) return;
		const pending = this.#pendingRequests.splice(idx, 1)[0];

		try {
			if (pending.isDelete) {
				this.#doDelete(pending.name, pending.request, pending.onComplete);
			} else {
				await this.#doOpen(
					pending.name,
					pending.version,
					pending.request,
					pending.onComplete,
				);
			}
		} catch (error) {
			pending.request[kReject](
				error instanceof DOMException
					? error
					: new DOMException(String(error), "UnknownError"),
			);
			pending.onComplete?.();
		}
	}

	async #processOpen(
		name: string,
		version: number | undefined,
		request: IDBOpenDBRequest,
		onComplete?: () => void,
	): Promise<void> {
		// Check if a version change is needed
		const oldVersion = this.#backend.getVersion(name);
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

		await this.#doOpen(name, version, request, onComplete);
	}

	#processDelete(
		name: string,
		request: IDBOpenDBRequest,
		onComplete?: () => void,
	): void {
		const oldVersion = this.#backend.getVersion(name);

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
		const oldVersion = this.#backend.getVersion(name);
		this.#backend.deleteDatabase(name);
		this.#schedulers.delete(name);
		this.#connections.delete(name);
		request[kResolveWithVersionChange](undefined, oldVersion);
		onComplete?.();
	}

	// ---- Private: Open implementation ----

	async #doOpen(
		name: string,
		version: number | undefined,
		request: IDBOpenDBRequest,
		onComplete?: () => void,
	): Promise<void> {
		// Check if database exists and get its current version
		const oldVersion = this.#backend.getVersion(name);

		// Default version
		const requestedVersion = version ?? (oldVersion || 1);

		if (requestedVersion < oldVersion) {
			throw VersionError(
				`Requested version (${requestedVersion}) is less than existing version (${oldVersion})`,
			);
		}

		// Open the backend connection (does NOT set version yet)
		const connection = await this.#backend.open(name, requestedVersion);
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
			transaction[kParent] = db;

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
				if (!db[kUpgradeTx]) {
					throw new DOMException(
						"The database is not running a version change transaction",
						"InvalidStateError",
					);
				}
				if (!transaction[kActive]) {
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
				db[kRefreshStoreNames]();
				// Update transaction scope to include new store
				if (!transaction[kScope].includes(storeName)) {
					transaction[kScope].push(storeName);
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
				if (!db[kUpgradeTx]) {
					throw new DOMException(
						"The database is not running a version change transaction",
						"InvalidStateError",
					);
				}
				if (!transaction[kActive]) {
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
						inst[kDeleted] = true;
						inst[kIndexNames].length = 0;
						for (const idx of inst[kIndexInstances]) {
							idx[kDeleted] = true;
						}
					}
				}
				backendTx.deleteObjectStore(storeName);
				db[kRefreshStoreNames]();
				const idx = transaction[kScope].indexOf(storeName);
				if (idx >= 0) {
					transaction[kScope].splice(idx, 1);
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
			(request as any)[kResolveWithoutEvent](db);

			// Synchronous metadata revert — runs during abort() BEFORE
			// the async abort event fires.  Ensures db.objectStoreNames,
			// db.version, store[kDeleted] etc. are correct immediately
			// after abort() returns.
			transaction[kOnSyncAbort] = () => {
				for (const inst of storeInstances) {
					if (createdStores.has(inst.name)) {
						inst[kDeleted] = true;
						inst[kIndexNames].length = 0;
						for (const idx of inst[kIndexInstances]) {
							idx[kDeleted] = true;
						}
					} else if (deletedStores.has(inst.name)) {
						inst[kDeleted] = false;
						for (const idx of inst[kIndexInstances]) {
							idx[kDeleted] = false;
						}
						const initial = initialIndexNames.get(inst.name) || [];
						inst[kIndexNames].length = 0;
						inst[kIndexNames].push(...initial);
					} else {
						const initial = initialIndexNames.get(inst.name) || [];
						for (const idx of inst[kIndexInstances]) {
							if (!initial.includes(idx.name)) {
								idx[kDeleted] = true;
							} else if (!inst[kIndexNames].includes(idx.name)) {
								idx[kDeleted] = false;
							}
						}
						inst[kIndexNames].length = 0;
						inst[kIndexNames].push(...initial);
					}
				}

				// Revert scope to original store names
				transaction[kScope].length = 0;
				transaction[kScope].push(...storeNames);
				for (const s of deletedStores) {
					if (!transaction[kScope].includes(s)) {
						transaction[kScope].push(s);
					}
				}
				for (const s of createdStores) {
					const idx = transaction[kScope].indexOf(s);
					if (idx >= 0) transaction[kScope].splice(idx, 1);
				}

				db[kRefreshStoreNames]();
				db[kSetVersion](oldVersion);

				// Unregister and close connection, clean up database synchronously
				// so databases() reflects the revert immediately.
				this.#unregisterConnection(name, db);
				db.close();
				if (oldVersion === 0) {
					try {
						this.#backend.deleteDatabase(name);
					} catch (_error) {
						/* ignored */
					}
				}
			};

			// Abort event listener — handles async cleanup.  The abort
			// event for versionchange fires as a macrotask (setTimeout
			// in transaction.abort()), so db[kUpgradeTx] and
			// request.transaction remain set through abort() return and
			// microtasks, matching spec timing.
			transaction.addEventListener("abort", () => {
				// Clear so abort-handler code sees InvalidStateError
				// from createObjectStore (not TransactionInactiveError).
				db[kUpgradeTx] = null;

				const abortError = new DOMException(
					"Version change transaction was aborted",
					"AbortError",
				);
				// Defer clearing request.transaction so other abort
				// listeners still see it during dispatch.
				queueMicrotask(() => {
					request[kSetTransaction](null);
					db.createObjectStore = originalCreateObjectStore;
					db.deleteObjectStore = originalDeleteObjectStore;
					request[kReject](abortError);
					onComplete?.();
				});
			});

			// Register early complete listener BEFORE upgradeneeded so that
			// db[kUpgradeTx] is cleared before test-registered listeners fire.
			// Spec: upgrade transaction reference is cleared before complete event.
			transaction.addEventListener("complete", () => {
				db[kUpgradeTx] = null;
			});

			// Fire upgradeneeded
			db[kUpgradeTx] = transaction;
			request[kSetTransaction](transaction);
			const upgradeHadError = request[kFireUpgradeNeeded](
				oldVersion,
				requestedVersion,
			);

			// Register complete listener AFTER upgradeneeded so that handlers
			// registered by the upgradeneeded callback fire before this one.
			// This ensures oncomplete fires before onsuccess per spec.
			transaction.addEventListener("complete", () => {
				db.createObjectStore = originalCreateObjectStore;
				db.deleteObjectStore = originalDeleteObjectStore;
				db[kRefreshStoreNames]();
				connection.commitVersion();
				request[kSetTransaction](null);
				// If db.close() was called during upgrade, finish closing
				// the backend connection and fire error instead of success
				if (db[kClosed]) {
					db[kFinishClose]();
					request[kReject](
						new DOMException(
							"The connection was closed during upgrade",
							"AbortError",
						),
					);
				} else {
					request[kResolve](db);
				}
				onComplete?.();
			});

			// If an exception was thrown during upgradeneeded, abort the transaction
			if (upgradeHadError && !transaction[kFinished]) {
				transaction.abort();
			}

			// Schedule auto-commit (only if not already aborted/committed)
			if (!transaction[kFinished]) {
				// Spec: deactivate after the upgradeneeded task's microtask checkpoint
				transaction[kScheduleDeactivation]();
				transaction[kScheduleAutoCommit]();
			}
		} else {
			// No upgrade needed — ensure version is set on the backend
			connection.setVersion(requestedVersion);
			request[kResolve](db);
			onComplete?.();
		}
	}
}

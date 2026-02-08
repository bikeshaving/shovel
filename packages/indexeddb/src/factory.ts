/**
 * IDBFactory implementation — the value of self.indexedDB.
 */

import type {IDBBackend} from "./backend.js";
import {IDBDatabase} from "./database.js";
import {IDBObjectStore} from "./object-store.js";
import {IDBTransaction} from "./transaction.js";
import {IDBOpenDBRequest} from "./request.js";
import {VersionError} from "./errors.js";
import {validateKeyPath} from "./key.js";
import type {TransactionMode} from "./types.js";

export class IDBFactory {
	#backend: IDBBackend;

	constructor(backend: IDBBackend) {
		this.#backend = backend;
	}

	/**
	 * Open a database.
	 */
	open(name: string, version?: number): IDBOpenDBRequest {
		// Web IDL [EnforceRange] unsigned long long validation
		if (version !== undefined) {
			if (typeof version !== "number" || !Number.isFinite(version) || version < 1 || Math.floor(version) !== version) {
				throw new TypeError(
					`Failed to execute 'open' on 'IDBFactory': The optional version provided (${version}) is not a valid integer version.`,
				);
			}
		}

		const request = new IDBOpenDBRequest();

		queueMicrotask(() => {
			try {
				this.#doOpen(name, version, request);
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

		queueMicrotask(() => {
			try {
				this.#backend.deleteDatabase(name);
				request._resolve(undefined);
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
		const {encodeKey, validateKey, compareKeys} = require("./key.js");
		const a = encodeKey(validateKey(first));
		const b = encodeKey(validateKey(second));
		return compareKeys(a, b);
	}

	// ---- Private ----

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

		// Open the backend connection
		const connection = this.#backend.open(name, requestedVersion);
		const db = new IDBDatabase(name, requestedVersion, connection);

		if (requestedVersion > oldVersion) {
			// Need to run upgrade
			const storeNames = Array.from(
				connection.getMetadata().objectStores.keys(),
			);
			const backendTx = connection.beginTransaction(
				storeNames,
				"versionchange",
			);
			const transaction = new IDBTransaction(
				db,
				storeNames,
				"versionchange" as TransactionMode,
				backendTx,
			);

			// The transaction's objectStore() needs to work during upgrade,
			// and createObjectStore needs to use this transaction
			const originalCreateObjectStore = db.createObjectStore.bind(db);
			db.createObjectStore = (
				storeName: string,
				options?: IDBObjectStoreParameters,
			) => {
				// Validate keyPath before other checks
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
				const meta = {
					name: storeName,
					keyPath: options?.keyPath ?? null,
					autoIncrement: options?.autoIncrement ?? false,
				};
				backendTx.createObjectStore(meta);
				db._refreshStoreNames();
				// Update transaction scope to include new store
				if (!transaction.objectStoreNames.includes(storeName)) {
					(transaction.objectStoreNames as string[]).push(storeName);
				}
				return new IDBObjectStore(transaction, meta);
			};

			const originalDeleteObjectStore = db.deleteObjectStore.bind(db);
			db.deleteObjectStore = (storeName: string) => {
				backendTx.deleteObjectStore(storeName);
				db._refreshStoreNames();
				const idx = (transaction.objectStoreNames as string[]).indexOf(
					storeName,
				);
				if (idx >= 0) {
					(transaction.objectStoreNames as string[]).splice(idx, 1);
				}
			};

			// Set the request result early so it's accessible in upgradeneeded
			// (IDB spec says result is available during upgradeneeded)
			(request as any)._resolveWithoutEvent(db);

			// Register listeners BEFORE firing upgradeneeded, because the
			// handler may call transaction.abort() synchronously.
			transaction.addEventListener("complete", () => {
				db.createObjectStore = originalCreateObjectStore;
				db.deleteObjectStore = originalDeleteObjectStore;
				db._refreshStoreNames();
				request._resolve(db);
			});

			transaction.addEventListener("abort", () => {
				db.createObjectStore = originalCreateObjectStore;
				db.deleteObjectStore = originalDeleteObjectStore;
				request._reject(
					new DOMException("Version change transaction was aborted", "AbortError"),
				);
			});

			// Fire upgradeneeded
			request._setTransaction(transaction);
			request._fireUpgradeNeeded(oldVersion, requestedVersion);

			// Schedule auto-commit after upgrade handler completes synchronously
			transaction._scheduleAutoCommit();
		} else {
			// No upgrade needed
			request._resolve(db);
		}
	}
}

/**
 * IDBDatabase implementation.
 */

import type {IDBBackendConnection} from "./backend.js";
import {IDBTransaction} from "./transaction.js";
import {IDBObjectStore} from "./object-store.js";
import {
	InvalidStateError,
	NotFoundError,
	ConstraintError,
} from "./errors.js";
import {validateKeyPath} from "./key.js";
import {makeDOMStringList} from "./types.js";
import type {ObjectStoreMeta, TransactionMode} from "./types.js";

export class IDBDatabase extends EventTarget {
	readonly name: string;
	#version: number;
	#connection: IDBBackendConnection;
	#closed: boolean = false;
	#objectStoreNames: string[];

	onabort: ((ev: Event) => void) | null = null;
	onclose: ((ev: Event) => void) | null = null;
	onerror: ((ev: Event) => void) | null = null;
	onversionchange: ((ev: Event) => void) | null = null;

	constructor(
		name: string,
		version: number,
		connection: IDBBackendConnection,
	) {
		super();
		this.name = name;
		this.#version = version;
		this.#connection = connection;

		const meta = connection.getMetadata();
		this.#objectStoreNames = Array.from(meta.objectStores.keys());
	}

	get version(): number {
		return this.#version;
	}

	get objectStoreNames(): DOMStringList {
		return makeDOMStringList(this.#objectStoreNames);
	}

	/**
	 * Create a transaction.
	 */
	transaction(
		storeNames: string | string[],
		mode: IDBTransactionMode = "readonly",
		options?: { durability?: string },
	): IDBTransaction {
		if (this.#closed) {
			throw InvalidStateError("Database connection is closed");
		}

		// Validate mode
		if (mode !== "readonly" && mode !== "readwrite") {
			throw new TypeError(
				`Failed to execute 'transaction' on 'IDBDatabase': The provided value '${mode}' is not a valid enum value of type IDBTransactionMode.`,
			);
		}

		const names = typeof storeNames === "string" ? [storeNames] : [...storeNames];

		if (names.length === 0) {
			throw new DOMException(
				"The storeNames parameter must not be empty",
				"InvalidAccessError",
			);
		}

		// Validate store names
		for (const name of names) {
			if (!this.#objectStoreNames.includes(name)) {
				throw NotFoundError(`Object store "${name}" not found`);
			}
		}

		const durability = options?.durability ?? "default";
		if (durability !== "default" && durability !== "strict" && durability !== "relaxed") {
			throw new TypeError(
				`Failed to execute 'transaction' on 'IDBDatabase': The provided value '${durability}' is not a valid enum value of type IDBTransactionDurability.`,
			);
		}

		const backendTx = this.#connection.beginTransaction(
			names,
			mode as TransactionMode,
		);
		return new IDBTransaction(this, names, mode as TransactionMode, backendTx, durability);
	}

	/**
	 * Create an object store (versionchange transactions only).
	 */
	createObjectStore(
		_name: string,
		_options?: IDBObjectStoreParameters,
	): IDBObjectStore {
		// This base implementation is only called outside of versionchange.
		// During upgradeneeded, factory.ts replaces this method.
		throw InvalidStateError(
			"Failed to execute 'createObjectStore' on 'IDBDatabase': " +
			"The database is not running a version change transaction.",
		);
	}

	/**
	 * Delete an object store (versionchange transactions only).
	 */
	deleteObjectStore(_name: string): void {
		throw InvalidStateError(
			"Failed to execute 'deleteObjectStore' on 'IDBDatabase': " +
			"The database is not running a version change transaction.",
		);
	}

	/**
	 * Close the database connection.
	 */
	close(): void {
		this.#closed = true;
	}

	/** @internal */
	get _connection(): IDBBackendConnection {
		return this.#connection;
	}

	/** @internal - Get object store metadata */
	_getStoreMeta(name: string): ObjectStoreMeta {
		const meta = this.#connection.getMetadata();
		const storeMeta = meta.objectStores.get(name);
		if (!storeMeta) {
			throw NotFoundError(`Object store "${name}" not found`);
		}
		return storeMeta;
	}

	/** @internal - Update store names after versionchange */
	_refreshStoreNames(): void {
		const meta = this.#connection.getMetadata();
		this.#objectStoreNames = Array.from(meta.objectStores.keys());
	}

	/** @internal - Update version */
	_setVersion(version: number): void {
		this.#version = version;
	}
}

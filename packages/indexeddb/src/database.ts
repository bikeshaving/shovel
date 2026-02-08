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
		// Return a DOMStringList-like array
		const names = [...this.#objectStoreNames].sort();
		return Object.assign(names, {
			contains(name: string) {
				return names.includes(name);
			},
			item(index: number) {
				return names[index] ?? null;
			},
		}) as unknown as DOMStringList;
	}

	/**
	 * Create a transaction.
	 */
	transaction(
		storeNames: string | string[],
		mode: IDBTransactionMode = "readonly",
	): IDBTransaction {
		if (this.#closed) {
			throw InvalidStateError("Database connection is closed");
		}

		const names = typeof storeNames === "string" ? [storeNames] : [...storeNames];

		// Validate store names
		for (const name of names) {
			if (!this.#objectStoreNames.includes(name)) {
				throw NotFoundError(`Object store "${name}" not found`);
			}
		}

		const backendTx = this.#connection.beginTransaction(
			names,
			mode as TransactionMode,
		);
		return new IDBTransaction(this, names, mode as TransactionMode, backendTx);
	}

	/**
	 * Create an object store (versionchange transactions only).
	 */
	createObjectStore(
		name: string,
		options?: IDBObjectStoreParameters,
	): IDBObjectStore {
		// Validate keyPath before checking for duplicates
		if (options?.keyPath !== undefined && options?.keyPath !== null) {
			validateKeyPath(options.keyPath);
		}

		if (this.#objectStoreNames.includes(name)) {
			throw ConstraintError(
				`Object store "${name}" already exists`,
			);
		}

		const meta: ObjectStoreMeta = {
			name,
			keyPath: options?.keyPath ?? null,
			autoIncrement: options?.autoIncrement ?? false,
		};

		this.#objectStoreNames.push(name);
		return new IDBObjectStore(null as any, meta);
	}

	/**
	 * Delete an object store (versionchange transactions only).
	 */
	deleteObjectStore(name: string): void {
		const idx = this.#objectStoreNames.indexOf(name);
		if (idx < 0) {
			throw NotFoundError(`Object store "${name}" not found`);
		}
		this.#objectStoreNames.splice(idx, 1);
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

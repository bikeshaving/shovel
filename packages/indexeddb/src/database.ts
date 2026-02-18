/**
 * IDBDatabase implementation.
 */

import type {IDBBackendConnection} from "./backend.js";
import {IDBTransaction} from "./transaction.js";
import {IDBObjectStore} from "./object-store.js";
import {SafeEventTarget} from "./event-target.js";
import {InvalidStateError, NotFoundError} from "./errors.js";
import {makeDOMStringList} from "./types.js";
import type {ObjectStoreMeta, TransactionMode} from "./types.js";
import type {TransactionScheduler} from "./scheduler.js";

export class IDBDatabase extends SafeEventTarget {
	readonly name: string;
	#version: number;
	#connection: IDBBackendConnection;
	#scheduler: TransactionScheduler | null;
	#closed!: boolean;
	#objectStoreNames: string[];

	get [Symbol.toStringTag](): string {
		return "IDBDatabase";
	}

	#onabortHandler!: ((ev: Event) => void) | null;
	#oncloseHandler!: ((ev: Event) => void) | null;
	#onerrorHandler!: ((ev: Event) => void) | null;
	#onversionchangeHandler!: ((ev: Event) => void) | null;

	get onabort(): ((ev: Event) => void) | null {
		return this.#onabortHandler;
	}
	set onabort(handler: ((ev: Event) => void) | null) {
		if (this.#onabortHandler) {
			this.removeEventListener("abort", this.#onabortHandler);
		}
		this.#onabortHandler = handler;
		if (handler) {
			this.addEventListener("abort", handler);
		}
	}

	get onclose(): ((ev: Event) => void) | null {
		return this.#oncloseHandler;
	}
	set onclose(handler: ((ev: Event) => void) | null) {
		if (this.#oncloseHandler) {
			this.removeEventListener("close", this.#oncloseHandler);
		}
		this.#oncloseHandler = handler;
		if (handler) {
			this.addEventListener("close", handler);
		}
	}

	get onerror(): ((ev: Event) => void) | null {
		return this.#onerrorHandler;
	}
	set onerror(handler: ((ev: Event) => void) | null) {
		if (this.#onerrorHandler) {
			this.removeEventListener("error", this.#onerrorHandler);
		}
		this.#onerrorHandler = handler;
		if (handler) {
			this.addEventListener("error", handler);
		}
	}

	get onversionchange(): ((ev: Event) => void) | null {
		return this.#onversionchangeHandler;
	}
	set onversionchange(handler: ((ev: Event) => void) | null) {
		if (this.#onversionchangeHandler) {
			this.removeEventListener("versionchange", this.#onversionchangeHandler);
		}
		this.#onversionchangeHandler = handler;
		if (handler) {
			this.addEventListener("versionchange", handler);
		}
	}

	/** @internal - the running versionchange transaction, if any */
	_upgradeTx: IDBTransaction | null;

	constructor(
		name: string,
		version: number,
		connection: IDBBackendConnection,
		scheduler: TransactionScheduler | null = null,
	) {
		super();
		this.name = name;
		this.#version = version;
		this.#connection = connection;
		this.#scheduler = scheduler;
		this.#closed = false;
		this._upgradeTx = null;
		this.#onabortHandler = null;
		this.#oncloseHandler = null;
		this.#onerrorHandler = null;
		this.#onversionchangeHandler = null;
		this.#onCloseCallback = null;

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
		options?: {durability?: string},
	): IDBTransaction {
		if (this.#closed) {
			throw InvalidStateError("Database connection is closed");
		}

		if (this._upgradeTx && !this._upgradeTx._finished) {
			throw InvalidStateError("A version change transaction is running");
		}

		const rawNames =
			typeof storeNames === "string" ? [storeNames] : [...storeNames];
		// Spec: deduplicate and sort store names
		const names = [...new Set(rawNames)].sort();

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

		// Spec: mode check comes after store name validation
		if (mode !== "readonly" && mode !== "readwrite") {
			throw new TypeError(
				`Failed to execute 'transaction' on 'IDBDatabase': The provided value '${mode}' is not a valid enum value of type IDBTransactionMode.`,
			);
		}

		const durability = options?.durability ?? "default";
		if (
			durability !== "default" &&
			durability !== "strict" &&
			durability !== "relaxed"
		) {
			throw new TypeError(
				`Failed to execute 'transaction' on 'IDBDatabase': The provided value '${durability}' is not a valid enum value of type IDBTransactionDurability.`,
			);
		}

		// Create transaction with deferred backend tx (scheduler controls start)
		const tx = new IDBTransaction(
			this,
			names,
			mode as TransactionMode,
			null,
			durability,
		);
		// Set parent for event bubbling: transaction → database
		tx._parent = this;

		if (this.#scheduler) {
			const conn = this.#connection;
			const entry = this.#scheduler.enqueue(names, mode as string, () => {
				const backendTx = conn.beginTransaction(names, mode as TransactionMode);
				tx._start(backendTx);
			});
			tx._onDone = () => this.#scheduler!.done(entry);
		} else {
			// No scheduler — start immediately (legacy/test path)
			const backendTx = this.#connection.beginTransaction(
				names,
				mode as TransactionMode,
			);
			tx._start(backendTx);
		}

		// Schedule auto-commit so empty transactions (no requests) complete
		tx._scheduleAutoCommit();
		// Spec: deactivate after the creating task's microtask checkpoint
		tx._scheduleDeactivation();
		return tx;
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

	#onCloseCallback!: (() => void) | null;

	/**
	 * Close the database connection.
	 * Per spec, sets the "close pending" flag immediately. The actual
	 * backend close is deferred if a versionchange transaction is
	 * still running (the factory completes the close when the tx finishes).
	 */
	close(): void {
		if (this.#closed) return;
		this.#closed = true;
		// Defer backend close while a versionchange transaction is active
		if (this._upgradeTx && !this._upgradeTx._finished) {
			return;
		}
		this.#connection.close();
		this.#onCloseCallback?.();
	}

	/** @internal - Actually close the backend connection (called by factory after upgrade tx finishes) */
	_finishClose(): void {
		this.#connection.close();
		this.#onCloseCallback?.();
	}

	/** @internal */
	get _connection(): IDBBackendConnection {
		return this.#connection;
	}

	/** @internal */
	get _closed(): boolean {
		return this.#closed;
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

	/** @internal - Set callback for when the connection is closed */
	_setOnClose(callback: () => void): void {
		this.#onCloseCallback = callback;
	}
}

/**
 * @b9g/async-context
 *
 * Lightweight polyfill for the TC39 AsyncContext proposal
 * https://github.com/tc39/proposal-async-context
 *
 * This implementation uses Node.js AsyncLocalStorage under the hood
 * to provide async context propagation across promise chains and async callbacks.
 */

import {AsyncLocalStorage} from "node:async_hooks";

// Registry of all Variable instances for Snapshot support
const variableRegistry = new Set<AsyncVariable<unknown>>();

// Sentinel value to represent "no value set" in snapshots
const NO_VALUE = Symbol("NO_VALUE");

/**
 * Options for creating an AsyncContext.Variable
 */
export interface AsyncVariableOptions<T> {
	/**
	 * Default value returned when no context value is set
	 */
	defaultValue?: T;

	/**
	 * Optional name for debugging purposes
	 */
	name?: string;
}

/**
 * AsyncContext.Variable - stores a value that propagates through async operations
 *
 * Based on the TC39 AsyncContext proposal (Stage 2)
 *
 * @example
 * ```ts
 * const userContext = new AsyncContext.Variable<User>();
 *
 * userContext.run(currentUser, async () => {
 *   await someAsyncOperation();
 *   const user = userContext.get(); // returns currentUser
 * });
 * ```
 */
export class AsyncVariable<T> {
	readonly #storage: AsyncLocalStorage<T>;
	readonly #defaultValue?: T;
	readonly #name?: string;

	constructor(options?: AsyncVariableOptions<T>) {
		this.#storage = new AsyncLocalStorage<T>();
		this.#defaultValue = options?.defaultValue;
		this.#name = options?.name;
		// Register this variable for Snapshot support
		variableRegistry.add(this as AsyncVariable<unknown>);
	}

	/**
	 * Execute a function with a context value
	 * The value is available via get() throughout the entire async execution
	 *
	 * @param value - The context value to set
	 * @param fn - The function to execute with the context
	 * @param args - Additional arguments to pass to fn
	 * @returns The return value of fn
	 */
	run<R, Args extends unknown[]>(
		value: T,
		fn: (...args: Args) => R,
		...args: Args
	): R {
		return this.#storage.run(value, fn, ...args);
	}

	/**
	 * Get the current context value
	 * Returns the default value if no context is set
	 *
	 * @returns The current context value or default value
	 */
	get(): T | undefined {
		const value = this.#storage.getStore();
		return value !== undefined ? value : this.#defaultValue;
	}

	/**
	 * Get the current context value (AsyncLocalStorage-compatible)
	 * This method provides compatibility with libraries expecting AsyncLocalStorage
	 *
	 * @returns The current context value (without default value)
	 */
	getStore(): T | undefined {
		return this.#storage.getStore();
	}

	/**
	 * Get the name of this variable (for debugging)
	 */
	get name(): string | undefined {
		return this.#name;
	}

	/**
	 * Internal: Get the underlying storage (used by Snapshot)
	 * @internal
	 */
	_getStorage(): AsyncLocalStorage<T> {
		return this.#storage;
	}
}

/**
 * AsyncContext.Snapshot - captures the current values of all Variables
 *
 * A Snapshot captures the state of all AsyncContext.Variable instances at the
 * time of construction. Later, calling `run()` restores that state for the
 * duration of the callback.
 *
 * @example
 * ```ts
 * const userVar = new AsyncContext.Variable<string>();
 *
 * userVar.run("alice", () => {
 *   const snapshot = new AsyncContext.Snapshot();
 *
 *   // Later, in a different context...
 *   userVar.run("bob", () => {
 *     console.log(userVar.get()); // "bob"
 *
 *     snapshot.run(() => {
 *       console.log(userVar.get()); // "alice"
 *     });
 *   });
 * });
 * ```
 */
export class AsyncSnapshot {
	readonly #captured: Map<AsyncVariable<unknown>, unknown>;

	constructor() {
		// Capture current values of all registered variables
		// We capture ALL variables, using NO_VALUE for undefined ones
		this.#captured = new Map();
		for (const variable of variableRegistry) {
			const value = variable.getStore();
			this.#captured.set(variable, value !== undefined ? value : NO_VALUE);
		}
	}

	/**
	 * Execute a function with the captured context values
	 *
	 * @param fn - The function to execute
	 * @param args - Additional arguments to pass to fn
	 * @returns The return value of fn
	 */
	run<R, Args extends unknown[]>(fn: (...args: Args) => R, ...args: Args): R {
		// Restore all captured values by nesting run() calls
		// For NO_VALUE, we run with undefined to clear any current context
		let result: () => R = () => fn(...args);

		for (const [variable, value] of this.#captured) {
			const prev = result;
			const actualValue = value === NO_VALUE ? undefined : value;
			result = () => variable._getStorage().run(actualValue, prev);
		}

		return result();
	}

	/**
	 * Wrap a function to capture the current context
	 *
	 * Creates a new function that, when called, will execute with the
	 * context values that were active when wrap() was called.
	 *
	 * @param fn - The function to wrap
	 * @returns A wrapped function that preserves context
	 *
	 * @example
	 * ```ts
	 * const userVar = new AsyncContext.Variable<string>();
	 *
	 * const wrappedFn = userVar.run("alice", () => {
	 *   return AsyncContext.Snapshot.wrap(() => {
	 *     return userVar.get();
	 *   });
	 * });
	 *
	 * // Later, even outside the run() context:
	 * wrappedFn(); // returns "alice"
	 * ```
	 */
	static wrap<T, A extends unknown[], R>(
		fn: (this: T, ...args: A) => R,
	): (this: T, ...args: A) => R {
		const snapshot = new AsyncSnapshot();
		return function (this: T, ...args: A): R {
			return snapshot.run(() => fn.apply(this, args));
		};
	}
}

/**
 * AsyncContext object matching the TC39 AsyncContext proposal
 */
export const AsyncContext = {
	Variable: AsyncVariable,
	Snapshot: AsyncSnapshot,
};

// Default export for convenience
export default AsyncContext;

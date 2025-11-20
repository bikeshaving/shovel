/**
 * @b9g/asynccontext-polyfill
 *
 * Lightweight polyfill for the TC39 AsyncContext proposal
 * https://github.com/tc39/proposal-async-context
 *
 * This implementation uses Node.js AsyncLocalStorage under the hood
 * to provide async context propagation across promise chains and async callbacks.
 */

import { AsyncLocalStorage } from "node:async_hooks";

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
 * const userContext = new AsyncVariable<User>();
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
  }

  /**
   * Execute a function with a context value
   * The value is available via get() throughout the entire async execution
   *
   * @param value - The context value to set
   * @param fn - The function to execute with the context
   * @returns The return value of fn
   */
  run<R>(value: T, fn: () => R): R {
    return this.#storage.run(value, fn);
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
}

/**
 * Namespace matching the TC39 AsyncContext proposal
 */
export namespace AsyncContext {
  /**
   * AsyncContext.Variable - stores a value that propagates through async operations
   */
  export class Variable<T> extends AsyncVariable<T> {}

  // Future additions from TC39 proposal:
  // - Snapshot (not yet implemented)
  // - Mapping (not yet implemented)
}

// Default export for convenience
export default AsyncContext;

/**
 * AsyncContext stub for browser Service Worker bundles.
 *
 * AsyncContext cannot be polyfilled in browsers — `await` uses the engine's
 * internal PerformPromiseThen which bypasses any userland hook. This stub
 * provides the API surface so @b9g/platform/runtime can be bundled.
 *
 * run()/get() work within synchronous execution. Context is lost after await.
 * This is fine — the only consumers (cookieStore, fetchDepth) degrade safely.
 */

export class AsyncVariable<T> {
	#defaultValue?: T;
	constructor(options?: {defaultValue?: T; name?: string}) {
		this.#defaultValue = options?.defaultValue;
	}
	run<R>(_value: T, fn: (...args: unknown[]) => R, ...args: unknown[]): R {
		return fn(...args);
	}
	get(): T | undefined {
		return this.#defaultValue;
	}
	getStore(): T | undefined {
		return undefined;
	}
}

export class AsyncSnapshot {
	run<R>(fn: (...args: unknown[]) => R, ...args: unknown[]): R {
		return fn(...args);
	}
	static wrap<T, A extends unknown[], R>(
		fn: (this: T, ...args: A) => R,
	): (this: T, ...args: A) => R {
		return fn;
	}
}

export const AsyncContext = {Variable: AsyncVariable, Snapshot: AsyncSnapshot};
export default AsyncContext;

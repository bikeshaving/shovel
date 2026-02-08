/**
 * WPT test registration functions mapped to bun:test
 *
 * WPT tests use synchronous test registration (calling promise_test/test adds
 * tests to a queue), then the tests are run. We implement this by collecting
 * tests into a queue that gets flushed when the runner calls flushTests().
 *
 * See: https://web-platform-tests.org/writing-tests/testharness-api.html
 */

import {test as bunTest, describe} from "bun:test";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["test", "wpt", "harness"]);

/**
 * Test context passed to WPT test functions.
 * Matches the WPT Test interface.
 */
export interface TestContext {
	/** Test name */
	name: string;
	/** Add a cleanup function to run after the test */
	add_cleanup(fn: () => void | Promise<void>): void;
	/** Step function — runs fn, fails the test on exception */
	step<T>(fn: () => T): T;
	/** Wraps fn so exceptions fail the test */
	step_func<T extends (...args: any[]) => any>(fn: T): T;
	/** Wraps fn so exceptions fail the test, then calls done() */
	step_func_done<T extends (...args: any[]) => any>(fn: T): T;
	/** Complete the test */
	done(): void;
	/** Returns a function that always fails the test */
	unreached_func(description?: string): (...args: any[]) => never;
	/** setTimeout that integrates with the test lifecycle */
	step_timeout(fn: () => void, ms: number): void;
}

interface QueuedTest {
	name: string;
	fn: (t: TestContext) => Promise<void> | void;
	isAsync: boolean;
}

// Global test queue - tests are registered synchronously and flushed later
const testQueue: QueuedTest[] = [];
let currentCleanups: Array<() => void | Promise<void>> = [];

function createTestContext(name: string): TestContext {
	const cleanups: Array<() => void | Promise<void>> = [];

	return {
		name,
		add_cleanup(fn: () => void | Promise<void>) {
			cleanups.push(fn);
			currentCleanups = cleanups;
		},
		step<T>(fn: () => T): T {
			return fn();
		},
		step_func<T extends (...args: any[]) => any>(fn: T): T {
			return fn;
		},
		step_func_done<T extends (...args: any[]) => any>(fn: T): T {
			return fn;
		},
		done() {
			// No-op for promise_test
		},
		unreached_func(description?: string) {
			return () => {
				throw new Error(description ?? "unreached code executed");
			};
		},
		step_timeout(fn: () => void, ms: number) {
			setTimeout(fn, ms);
		},
	};
}

/**
 * Register a promise-based test.
 * Signature: promise_test(fn, name, properties?)
 */
export function promise_test(
	fn: (t: TestContext) => Promise<void>,
	name: string,
	_properties?: object,
): void {
	testQueue.push({name, fn, isAsync: true});
}

/**
 * Register a synchronous test.
 * Signature: test(fn, name, properties?)
 */
export function test(
	fn: (t: TestContext) => void,
	name: string,
	_properties?: object,
): void {
	testQueue.push({name, fn, isAsync: false});
}

/**
 * Register an async test (callback-style).
 *
 * Supports two forms:
 *   async_test(fn, name, properties?) — registers fn as the test body
 *   async_test(name, properties?)     — returns a TestContext for manual step/done
 *
 * The returned TestContext's done()/step()/etc. are immediately functional.
 * If done() is called before the test's Promise wrapper is created (e.g. by
 * a microtask-fired event handler), it latches and resolves immediately when
 * the Promise is finally created during test execution.
 */
export function async_test(
	fnOrName: ((t: TestContext) => void) | string,
	nameOrProperties?: string | object,
	_properties?: object,
): TestContext {
	let fn: ((t: TestContext) => void) | undefined;
	let name: string;

	if (typeof fnOrName === "string") {
		// Single-arg form: async_test("description")
		name = fnOrName;
		fn = undefined;
	} else {
		// Two-arg form: async_test(fn, "description")
		fn = fnOrName;
		name = (nameOrProperties as string) ?? "unnamed async_test";
	}

	// Deferred resolve/reject — works before the Promise is created
	let resolveFn: (() => void) | null = null;
	let rejectFn: ((e: any) => void) | null = null;
	let settled = false;
	let earlyResult: {type: "resolve"} | {type: "reject"; error: any} | null =
		null;

	function doDone() {
		if (settled) return;
		settled = true;
		if (resolveFn) {
			resolveFn();
		} else {
			earlyResult = {type: "resolve"};
		}
	}

	function doReject(e: any) {
		if (settled) return;
		settled = true;
		if (rejectFn) {
			rejectFn(e);
		} else {
			earlyResult = {type: "reject", error: e};
		}
	}

	const cleanups: Array<() => void | Promise<void>> = [];

	const ctx: TestContext = {
		name,
		add_cleanup(cleanupFn: () => void | Promise<void>) {
			cleanups.push(cleanupFn);
			currentCleanups = cleanups;
		},
		step<T>(stepFn: () => T): T {
			try {
				return stepFn();
			} catch (e) {
				doReject(e);
				return undefined as T;
			}
		},
		step_func<T extends (...args: any[]) => any>(stepFn: T): T {
			return ((...args: any[]) => {
				try {
					return stepFn(...args);
				} catch (e) {
					doReject(e);
				}
			}) as T;
		},
		step_func_done<T extends (...args: any[]) => any>(stepFn: T): T {
			return ((...args: any[]) => {
				try {
					const result = stepFn(...args);
					doDone();
					return result;
				} catch (e) {
					doReject(e);
				}
			}) as T;
		},
		done: doDone,
		unreached_func(description?: string) {
			return (..._args: any[]) => {
				const err = new Error(description ?? "unreached code executed");
				doReject(err);
				throw err;
			};
		},
		step_timeout(cb: () => void, ms: number) {
			setTimeout(() => {
				try {
					cb();
				} catch (e) {
					doReject(e);
				}
			}, ms);
		},
	};

	// Call fn immediately — just like the browser WPT harness.
	// This is critical for tests that register event handlers synchronously
	// (e.g. createdb_for_multiple_tests pattern) before microtasks fire.
	if (fn) {
		try {
			fn(ctx);
		} catch (e) {
			doReject(e);
		}
	}

	testQueue.push({
		name,
		fn: () => {
			return new Promise<void>((resolve, reject) => {
				resolveFn = resolve;
				rejectFn = reject;

				// If already settled before the Promise was created, resolve now
				if (earlyResult) {
					if (earlyResult.type === "resolve") {
						resolve();
					} else {
						reject(earlyResult.error);
					}
				}
			});
		},
		isAsync: true,
	});

	return ctx;
}

/**
 * step_timeout — setTimeout that integrates with the test lifecycle.
 * Global version (not attached to a test context).
 */
export function step_timeout(fn: () => void, ms: number): number {
	return setTimeout(fn, ms) as unknown as number;
}

/**
 * format_value — format a value for display in error messages.
 */
export function format_value(value: unknown): string {
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);
	if (typeof value === "function") return `function "${value.name || "anonymous"}"`;
	if (Array.isArray(value)) return `[${value.map(format_value).join(", ")}]`;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

/**
 * Flush all queued tests into a bun:test describe block
 */
export function flushTests(
	suiteName: string,
	options?: {timeout?: number},
): void {
	const tests = [...testQueue];
	testQueue.length = 0;
	const timeout = options?.timeout;

	describe(suiteName, () => {
		for (const {name, fn, isAsync} of tests) {
			const testOpts = timeout ? {timeout} : undefined;
			bunTest(name, async () => {
				currentCleanups = [];
				const ctx = createTestContext(name);
				try {
					if (isAsync) {
						await fn(ctx);
					} else {
						fn(ctx);
					}
				} finally {
					// Run cleanups in reverse order
					for (const cleanup of currentCleanups.reverse()) {
						await cleanup();
					}
				}
			}, testOpts);
		}
	});
}

/**
 * Clear the test queue without running tests
 */
export function clearTestQueue(): void {
	testQueue.length = 0;
}

/**
 * Get the number of queued tests (for debugging)
 */
export function getQueuedTestCount(): number {
	return testQueue.length;
}

/**
 * Setup function - WPT tests can call this to configure the test environment
 */
export function setup(_options?: object): void {
	// No-op - bun:test handles test setup differently
}

/**
 * Done function - WPT tests call this when they're finished defining tests
 */
export function done(): void {
	// No-op - we call flushTests explicitly from the runner
}

/**
 * Result from running a single test
 */
export interface TestResult {
	name: string;
	passed: boolean;
	error?: Error;
}

/**
 * Run all queued tests immediately and return results
 */
export async function runQueuedTests(): Promise<TestResult[]> {
	const tests = [...testQueue];
	testQueue.length = 0;

	const results: TestResult[] = [];

	for (const {name, fn, isAsync} of tests) {
		currentCleanups = [];
		const ctx = createTestContext(name);

		try {
			if (isAsync) {
				await fn(ctx);
			} else {
				fn(ctx);
			}
			results.push({name, passed: true});
		} catch (error) {
			results.push({
				name,
				passed: false,
				error: error instanceof Error ? error : new Error(String(error)),
			});
		} finally {
			// Run cleanups in reverse order
			for (const cleanup of currentCleanups.reverse()) {
				try {
					await cleanup();
				} catch (err) {
					logger.debug`Cleanup error: ${err}`;
				}
			}
		}
	}

	return results;
}

/**
 * Get all queued tests (for inspection)
 */
export function getQueuedTests(): Array<{name: string; isAsync: boolean}> {
	return testQueue.map(({name, isAsync}) => ({name, isAsync}));
}

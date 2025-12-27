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
 * Test context passed to WPT test functions
 */
export interface TestContext {
	/** Add a cleanup function to run after the test */
	add_cleanup(fn: () => void | Promise<void>): void;
	/** Step function for async tests */
	step<T>(fn: () => T): T;
	/** Step function for async tests with timeout */
	step_func<T extends (...args: unknown[]) => unknown>(fn: T): T;
	/** Step function that completes the test */
	step_func_done<T extends (...args: unknown[]) => unknown>(fn: T): T;
	/** Complete the test */
	done(): void;
	/** Unreached step */
	unreached_func(description?: string): () => never;
}

interface QueuedTest {
	name: string;
	fn: (t: TestContext) => Promise<void> | void;
	isAsync: boolean;
}

// Global test queue - tests are registered synchronously and flushed later
const testQueue: QueuedTest[] = [];
let currentCleanups: Array<() => void | Promise<void>> = [];

function createTestContext(): TestContext {
	const cleanups: Array<() => void | Promise<void>> = [];

	return {
		add_cleanup(fn: () => void | Promise<void>) {
			cleanups.push(fn);
			currentCleanups = cleanups;
		},
		step<T>(fn: () => T): T {
			return fn();
		},
		step_func<T extends (...args: unknown[]) => unknown>(fn: T): T {
			return fn;
		},
		step_func_done<T extends (...args: unknown[]) => unknown>(fn: T): T {
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
	};
}

/**
 * Register a promise-based test
 *
 * @param fn Test function that returns a promise
 * @param name Test description
 */
export function promise_test(
	fn: (t: TestContext) => Promise<void>,
	name: string,
): void {
	testQueue.push({name, fn, isAsync: true});
}

/**
 * Register a synchronous test
 *
 * @param fn Test function
 * @param name Test description
 */
export function test(fn: (t: TestContext) => void, name: string): void {
	testQueue.push({name, fn, isAsync: false});
}

/**
 * Register an async test (callback-style)
 *
 * @param fn Test function that receives a test context
 * @param name Test description
 */
export function async_test(
	fn: (t: TestContext) => void,
	name: string,
): TestContext {
	const ctx = createTestContext();
	// For async_test, we wrap it in a promise
	testQueue.push({
		name,
		fn: () => {
			return new Promise<void>((resolve, reject) => {
				const wrappedCtx: TestContext = {
					...ctx,
					done: resolve,
					step: <T>(stepFn: () => T): T => {
						try {
							return stepFn();
						} catch (e) {
							reject(e);
							throw e;
						}
					},
					step_func: <T extends (...args: unknown[]) => unknown>(
						stepFn: T,
					): T => {
						return ((...args: unknown[]) => {
							try {
								return stepFn(...args);
							} catch (e) {
								reject(e);
								throw e;
							}
						}) as T;
					},
					step_func_done: <T extends (...args: unknown[]) => unknown>(
						stepFn: T,
					): T => {
						return ((...args: unknown[]) => {
							try {
								const result = stepFn(...args);
								resolve();
								return result;
							} catch (e) {
								reject(e);
								throw e;
							}
						}) as T;
					},
				};
				fn(wrappedCtx);
			});
		},
		isAsync: true,
	});
	return ctx;
}

/**
 * Flush all queued tests into a bun:test describe block
 *
 * @param suiteName Name for the test suite
 */
export function flushTests(suiteName: string): void {
	const tests = [...testQueue];
	testQueue.length = 0;

	describe(suiteName, () => {
		for (const {name, fn, isAsync} of tests) {
			bunTest(name, async () => {
				currentCleanups = [];
				const ctx = createTestContext();
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
			});
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
 * For bun:test compatibility, this is a no-op
 */
export function setup(_options?: object): void {
	// No-op - bun:test handles test setup differently
}

/**
 * Done function - WPT tests call this when they're finished defining tests
 * For bun:test compatibility, this triggers flushTests
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
 *
 * Use this when you can't use flushTests() (e.g., inside a test function).
 * This executes tests sequentially and reports results.
 */
export async function runQueuedTests(): Promise<TestResult[]> {
	const tests = [...testQueue];
	testQueue.length = 0;

	const results: TestResult[] = [];

	for (const {name, fn, isAsync} of tests) {
		currentCleanups = [];
		const ctx = createTestContext();

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

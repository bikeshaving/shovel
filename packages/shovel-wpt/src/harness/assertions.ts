/**
 * WPT assertion functions mapped to bun:test expect()
 *
 * See: https://web-platform-tests.org/writing-tests/testharness-api.html#assertions
 */

import {expect} from "bun:test";

/**
 * Assert that actual is strictly equal to expected
 */
export function assert_equals<T>(
	actual: T,
	expected: T,
	description?: string,
): void {
	if (description) {
		expect(actual, description).toBe(expected);
	} else {
		expect(actual).toBe(expected);
	}
}

/**
 * Assert that actual is not strictly equal to expected
 */
export function assert_not_equals<T>(
	actual: T,
	expected: T,
	description?: string,
): void {
	if (description) {
		expect(actual, description).not.toBe(expected);
	} else {
		expect(actual).not.toBe(expected);
	}
}

/**
 * Assert that actual is true (===)
 */
export function assert_true(actual: unknown, description?: string): void {
	if (description) {
		expect(actual, description).toBe(true);
	} else {
		expect(actual).toBe(true);
	}
}

/**
 * Assert that actual is false (===)
 */
export function assert_false(actual: unknown, description?: string): void {
	if (description) {
		expect(actual, description).toBe(false);
	} else {
		expect(actual).toBe(false);
	}
}

/**
 * Assert that arrays are equal (element-wise comparison)
 */
export function assert_array_equals<T>(
	actual: ArrayLike<T>,
	expected: ArrayLike<T>,
	description?: string,
): void {
	const actualArr = Array.from(actual);
	const expectedArr = Array.from(expected);
	if (description) {
		expect(actualArr, description).toEqual(expectedArr);
	} else {
		expect(actualArr).toEqual(expectedArr);
	}
}

/**
 * Assert that objects are deeply equal
 */
export function assert_object_equals(
	actual: object,
	expected: object,
	description?: string,
): void {
	if (description) {
		expect(actual, description).toEqual(expected);
	} else {
		expect(actual).toEqual(expected);
	}
}

/**
 * Assert that a function throws a JavaScript error of the expected type
 */
export function assert_throws_js(
	errorType: ErrorConstructor,
	fn: () => void,
	description?: string,
): void {
	if (description) {
		expect(fn, description).toThrow(errorType);
	} else {
		expect(fn).toThrow(errorType);
	}
}

/**
 * Assert that a function throws a DOMException with the expected name
 */
export function assert_throws_dom(
	name: string,
	fn: () => void,
	description?: string,
): void {
	let threw = false;
	let caught: unknown;
	try {
		fn();
	} catch (e) {
		threw = true;
		caught = e;
	}
	if (!threw) {
		throw new Error(
			description
				? `${description}: Expected to throw DOMException with name "${name}"`
				: `Expected to throw DOMException with name "${name}"`,
		);
	}
	if (caught instanceof DOMException) {
		if (description) {
			expect(caught.name, description).toBe(name);
		} else {
			expect(caught.name).toBe(name);
		}
	} else if (caught instanceof Error && "name" in caught) {
		// Some implementations use Error subclasses with name property
		if (description) {
			expect(caught.name, description).toBe(name);
		} else {
			expect(caught.name).toBe(name);
		}
	} else {
		throw new Error(
			description
				? `${description}: Expected DOMException with name "${name}", got ${caught}`
				: `Expected DOMException with name "${name}", got ${caught}`,
		);
	}
}

/**
 * Assert that an async function throws a DOMException with the expected name
 */
export async function assert_throws_dom_async(
	name: string,
	fn: () => Promise<unknown>,
	description?: string,
): Promise<void> {
	let threw = false;
	let caught: unknown;
	try {
		await fn();
	} catch (e) {
		threw = true;
		caught = e;
	}
	if (!threw) {
		throw new Error(
			description
				? `${description}: Expected to throw DOMException with name "${name}"`
				: `Expected to throw DOMException with name "${name}"`,
		);
	}
	if (caught instanceof DOMException) {
		if (description) {
			expect(caught.name, description).toBe(name);
		} else {
			expect(caught.name).toBe(name);
		}
	} else if (caught instanceof Error && "name" in caught) {
		if (description) {
			expect(caught.name, description).toBe(name);
		} else {
			expect(caught.name).toBe(name);
		}
	} else {
		throw new Error(
			description
				? `${description}: Expected DOMException with name "${name}", got ${caught}`
				: `Expected DOMException with name "${name}", got ${caught}`,
		);
	}
}

/**
 * Assert that code path should never be reached
 */
export function assert_unreached(description?: string): never {
	throw new Error(description ?? "assert_unreached was called");
}

/**
 * Assert that a value is an instance of a class
 */
export function assert_class_string(
	object: unknown,
	className: string,
	description?: string,
): void {
	const actualClassName = Object.prototype.toString.call(object).slice(8, -1);
	if (description) {
		expect(actualClassName, description).toBe(className);
	} else {
		expect(actualClassName).toBe(className);
	}
}

/**
 * Assert that a value is greater than another
 */
export function assert_greater_than(
	actual: number,
	expected: number,
	description?: string,
): void {
	if (description) {
		expect(actual, description).toBeGreaterThan(expected);
	} else {
		expect(actual).toBeGreaterThan(expected);
	}
}

/**
 * Assert that a value is greater than or equal to another
 */
export function assert_greater_than_equal(
	actual: number,
	expected: number,
	description?: string,
): void {
	if (description) {
		expect(actual, description).toBeGreaterThanOrEqual(expected);
	} else {
		expect(actual).toBeGreaterThanOrEqual(expected);
	}
}

/**
 * Assert that a value is less than another
 */
export function assert_less_than(
	actual: number,
	expected: number,
	description?: string,
): void {
	if (description) {
		expect(actual, description).toBeLessThan(expected);
	} else {
		expect(actual).toBeLessThan(expected);
	}
}

/**
 * Assert that a value is less than or equal to another
 */
export function assert_less_than_equal(
	actual: number,
	expected: number,
	description?: string,
): void {
	if (description) {
		expect(actual, description).toBeLessThanOrEqual(expected);
	} else {
		expect(actual).toBeLessThanOrEqual(expected);
	}
}

/**
 * Assert that actual is loosely equal to expected (==)
 */
export function assert_approx_equals(
	actual: number,
	expected: number,
	epsilon: number,
	description?: string,
): void {
	const diff = Math.abs(actual - expected);
	if (diff > epsilon) {
		throw new Error(
			description
				? `${description}: Expected ${actual} to be within ${epsilon} of ${expected}, but difference was ${diff}`
				: `Expected ${actual} to be within ${epsilon} of ${expected}, but difference was ${diff}`,
		);
	}
}

/**
 * Assert that a string matches a regular expression
 */
export function assert_regexp_match(
	actual: string,
	expected: RegExp,
	description?: string,
): void {
	if (description) {
		expect(actual, description).toMatch(expected);
	} else {
		expect(actual).toMatch(expected);
	}
}

/**
 * Assert that an object has an own property
 */
export function assert_own_property(
	object: object,
	propertyName: string,
	description?: string,
): void {
	const has = Object.prototype.hasOwnProperty.call(object, propertyName);
	if (!has) {
		throw new Error(
			description
				? `${description}: Expected object to have own property "${propertyName}"`
				: `Expected object to have own property "${propertyName}"`,
		);
	}
}

/**
 * Assert that an object inherits a property
 */
export function assert_inherits(
	object: object,
	propertyName: string,
	description?: string,
): void {
	if (!(propertyName in object)) {
		throw new Error(
			description
				? `${description}: Expected object to inherit property "${propertyName}"`
				: `Expected object to inherit property "${propertyName}"`,
		);
	}
}

/**
 * Assert that a promise rejects with a DOMException of the given name
 */
export async function promise_rejects_dom(
	testContext: {unreached_func?: (msg: string) => () => never},
	name: string,
	promise: Promise<unknown>,
	description?: string,
): Promise<void> {
	try {
		await promise;
		throw new Error(
			description
				? `${description}: Expected promise to reject with DOMException "${name}"`
				: `Expected promise to reject with DOMException "${name}"`,
		);
	} catch (e) {
		if (e instanceof DOMException) {
			expect(e.name).toBe(name);
		} else if (
			e instanceof Error &&
			e.message.includes("Expected promise to reject")
		) {
			throw e; // Re-throw our assertion error
		} else if (e instanceof Error && "name" in e) {
			// Some implementations use Error subclasses with name property
			expect((e as any).name).toBe(name);
		} else {
			throw new Error(
				description
					? `${description}: Expected DOMException with name "${name}", got ${e}`
					: `Expected DOMException with name "${name}", got ${e}`,
			);
		}
	}
}

/**
 * Assert that a promise rejects with a JavaScript error of the given type
 */
export async function promise_rejects_js(
	testContext: {unreached_func?: (msg: string) => () => never},
	errorType: ErrorConstructor,
	promise: Promise<unknown>,
	description?: string,
): Promise<void> {
	try {
		await promise;
		throw new Error(
			description
				? `${description}: Expected promise to reject with ${errorType.name}`
				: `Expected promise to reject with ${errorType.name}`,
		);
	} catch (e) {
		if (
			e instanceof Error &&
			e.message.includes("Expected promise to reject")
		) {
			throw e; // Re-throw our assertion error
		}
		expect(e).toBeInstanceOf(errorType);
	}
}

/**
 * Assert that an object has an IDL attribute (own or inherited)
 */
export function assert_idl_attribute(
	object: object,
	propertyName: string,
	description?: string,
): void {
	if (!(propertyName in (object as any))) {
		throw new Error(
			description
				? `${description}: Expected object to have IDL attribute "${propertyName}"`
				: `Expected object to have IDL attribute "${propertyName}"`,
		);
	}
}

/**
 * Assert that a property is readonly (assignment doesn't change the value)
 */
export function assert_readonly(
	object: any,
	propertyName: string,
	description?: string,
): void {
	const initial = object[propertyName];
	try {
		object[propertyName] = initial + "CHANGED";
	} catch {
		// Throws in strict mode — that's fine, it's readonly
	}
	if (object[propertyName] !== initial) {
		throw new Error(
			description
				? `${description}: Property "${propertyName}" is not readonly`
				: `Property "${propertyName}" is not readonly`,
		);
	}
}

/**
 * Assert that a function throws a specific value (identity check)
 */
export function assert_throws_exactly(
	expectedError: any,
	fn: () => void,
	description?: string,
): void {
	try {
		fn();
		throw new Error(
			description
				? `${description}: Expected function to throw`
				: "Expected function to throw",
		);
	} catch (e) {
		if (
			e instanceof Error &&
			e.message.includes("Expected function to throw")
		) {
			throw e;
		}
		if (e !== expectedError) {
			throw new Error(
				description
					? `${description}: Expected thrown value to be ${expectedError}, got ${e}`
					: `Expected thrown value to be ${expectedError}, got ${e}`,
			);
		}
	}
}

/**
 * Assert that a promise rejects with a specific value (identity check)
 */
export async function promise_rejects_exactly(
	testContext: {unreached_func?: (msg: string) => () => never},
	expectedError: Error,
	promise: Promise<unknown>,
	description?: string,
): Promise<void> {
	try {
		await promise;
		throw new Error(
			description
				? `${description}: Expected promise to reject`
				: "Expected promise to reject",
		);
	} catch (e) {
		if (
			e instanceof Error &&
			e.message.includes("Expected promise to reject")
		) {
			throw e;
		}
		expect(e).toBe(expectedError);
	}
}

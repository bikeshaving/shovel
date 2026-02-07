import {describe, expect, it} from "bun:test";
import {IDBKeyRange} from "../src/key-range.js";

describe("IDBKeyRange.only", () => {
	it("includes only the exact key", () => {
		const range = IDBKeyRange.only(5);
		expect(range.includes(5)).toBe(true);
		expect(range.includes(4)).toBe(false);
		expect(range.includes(6)).toBe(false);
	});

	it("works with strings", () => {
		const range = IDBKeyRange.only("hello");
		expect(range.includes("hello")).toBe(true);
		expect(range.includes("world")).toBe(false);
	});
});

describe("IDBKeyRange.lowerBound", () => {
	it("closed lower bound", () => {
		const range = IDBKeyRange.lowerBound(5);
		expect(range.includes(4)).toBe(false);
		expect(range.includes(5)).toBe(true);
		expect(range.includes(6)).toBe(true);
		expect(range.includes(100)).toBe(true);
	});

	it("open lower bound", () => {
		const range = IDBKeyRange.lowerBound(5, true);
		expect(range.includes(5)).toBe(false);
		expect(range.includes(5.001)).toBe(true);
		expect(range.includes(6)).toBe(true);
	});
});

describe("IDBKeyRange.upperBound", () => {
	it("closed upper bound", () => {
		const range = IDBKeyRange.upperBound(10);
		expect(range.includes(9)).toBe(true);
		expect(range.includes(10)).toBe(true);
		expect(range.includes(11)).toBe(false);
	});

	it("open upper bound", () => {
		const range = IDBKeyRange.upperBound(10, true);
		expect(range.includes(10)).toBe(false);
		expect(range.includes(9.999)).toBe(true);
	});
});

describe("IDBKeyRange.bound", () => {
	it("closed both", () => {
		const range = IDBKeyRange.bound(5, 10);
		expect(range.includes(4)).toBe(false);
		expect(range.includes(5)).toBe(true);
		expect(range.includes(7)).toBe(true);
		expect(range.includes(10)).toBe(true);
		expect(range.includes(11)).toBe(false);
	});

	it("open lower", () => {
		const range = IDBKeyRange.bound(5, 10, true, false);
		expect(range.includes(5)).toBe(false);
		expect(range.includes(6)).toBe(true);
		expect(range.includes(10)).toBe(true);
	});

	it("open upper", () => {
		const range = IDBKeyRange.bound(5, 10, false, true);
		expect(range.includes(5)).toBe(true);
		expect(range.includes(10)).toBe(false);
	});

	it("open both", () => {
		const range = IDBKeyRange.bound(5, 10, true, true);
		expect(range.includes(5)).toBe(false);
		expect(range.includes(6)).toBe(true);
		expect(range.includes(9)).toBe(true);
		expect(range.includes(10)).toBe(false);
	});

	it("throws if lower > upper", () => {
		expect(() => IDBKeyRange.bound(10, 5)).toThrow();
	});

	it("throws if equal bounds with open", () => {
		expect(() => IDBKeyRange.bound(5, 5, true, false)).toThrow();
		expect(() => IDBKeyRange.bound(5, 5, false, true)).toThrow();
	});

	it("allows equal bounds both closed", () => {
		const range = IDBKeyRange.bound(5, 5);
		expect(range.includes(5)).toBe(true);
	});
});

describe("IDBKeyRange properties", () => {
	it("exposes lower, upper, lowerOpen, upperOpen", () => {
		const range = IDBKeyRange.bound(1, 10, true, false);
		expect(range.lower).toBe(1);
		expect(range.upper).toBe(10);
		expect(range.lowerOpen).toBe(true);
		expect(range.upperOpen).toBe(false);
	});

	it("lowerBound has no upper", () => {
		const range = IDBKeyRange.lowerBound(5);
		expect(range.lower).toBe(5);
		expect(range.upper).toBeUndefined();
	});

	it("upperBound has no lower", () => {
		const range = IDBKeyRange.upperBound(10);
		expect(range.lower).toBeUndefined();
		expect(range.upper).toBe(10);
	});
});

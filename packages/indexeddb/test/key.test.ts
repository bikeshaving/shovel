import {describe, expect, it} from "bun:test";
import {encodeKey, decodeKey, compareKeys, validateKey} from "../src/key.js";

describe("key validation", () => {
	it("accepts numbers", () => {
		expect(validateKey(42)).toBe(42);
		expect(validateKey(0)).toBe(0);
		expect(validateKey(-1)).toBe(-1);
		expect(validateKey(Infinity)).toBe(Infinity);
		expect(validateKey(-Infinity)).toBe(-Infinity);
	});

	it("rejects NaN", () => {
		expect(() => validateKey(NaN)).toThrow("NaN");
	});

	it("accepts strings", () => {
		expect(validateKey("hello")).toBe("hello");
		expect(validateKey("")).toBe("");
	});

	it("accepts Dates", () => {
		const d = new Date("2024-01-01");
		expect(validateKey(d)).toBe(d);
	});

	it("rejects invalid Dates", () => {
		expect(() => validateKey(new Date("invalid"))).toThrow("Invalid Date");
	});

	it("accepts ArrayBuffer", () => {
		const buf = new ArrayBuffer(4);
		expect(validateKey(buf)).toBe(buf);
	});

	it("accepts typed arrays (converts to ArrayBuffer)", () => {
		const arr = new Uint8Array([1, 2, 3]);
		const result = validateKey(arr);
		expect(result).toBeInstanceOf(ArrayBuffer);
	});

	it("accepts arrays", () => {
		const result = validateKey([1, "a", new Date()]);
		expect(Array.isArray(result)).toBe(true);
	});

	it("rejects objects", () => {
		expect(() => validateKey({})).toThrow();
	});

	it("rejects null/undefined", () => {
		expect(() => validateKey(null)).toThrow();
		expect(() => validateKey(undefined)).toThrow();
	});

	it("rejects booleans", () => {
		expect(() => validateKey(true)).toThrow();
	});
});

describe("key encoding roundtrip", () => {
	it("numbers", () => {
		for (const n of [0, 1, -1, 42, -42, 0.5, -0.5, Infinity, -Infinity]) {
			expect(decodeKey(encodeKey(n))).toBe(n);
		}
	});

	it("negative zero", () => {
		const decoded = decodeKey(encodeKey(-0));
		expect(Object.is(decoded, -0)).toBe(true);
	});

	it("strings", () => {
		for (const s of ["", "hello", "a\0b", "unicode: \u00e9\u00e8\u00ea"]) {
			expect(decodeKey(encodeKey(s))).toBe(s);
		}
	});

	it("dates", () => {
		const d = new Date("2024-06-15T12:00:00Z");
		const decoded = decodeKey(encodeKey(d));
		expect(decoded).toBeInstanceOf(Date);
		expect((decoded as Date).getTime()).toBe(d.getTime());
	});

	it("binary (ArrayBuffer)", () => {
		const buf = new Uint8Array([1, 2, 3, 4]).buffer;
		const decoded = decodeKey(encodeKey(buf)) as ArrayBuffer;
		expect(new Uint8Array(decoded)).toEqual(new Uint8Array([1, 2, 3, 4]));
	});

	it("empty ArrayBuffer", () => {
		const buf = new ArrayBuffer(0);
		const decoded = decodeKey(encodeKey(buf)) as ArrayBuffer;
		expect(decoded.byteLength).toBe(0);
	});

	it("arrays", () => {
		const key = [1, "hello", new Date("2024-01-01")];
		const decoded = decodeKey(encodeKey(key)) as unknown[];
		expect(decoded.length).toBe(3);
		expect(decoded[0]).toBe(1);
		expect(decoded[1]).toBe("hello");
		expect((decoded[2] as Date).getTime()).toBe(
			new Date("2024-01-01").getTime(),
		);
	});

	it("nested arrays", () => {
		const key = [1, [2, 3], "a"];
		const decoded = decodeKey(encodeKey(key)) as unknown[];
		expect(decoded.length).toBe(3);
		expect(decoded[0]).toBe(1);
		expect(decoded[1]).toEqual([2, 3]);
		expect(decoded[2]).toBe("a");
	});

	it("empty array", () => {
		const decoded = decodeKey(encodeKey([]));
		expect(decoded).toEqual([]);
	});
});

describe("key ordering", () => {
	it("numbers are ordered correctly", () => {
		const keys = [-Infinity, -100, -1, -0.5, 0, 0.5, 1, 100, Infinity];
		// -0 sorts equal to 0 in IndexedDB
		for (let i = 0; i < keys.length - 1; i++) {
			const a = encodeKey(keys[i]);
			const b = encodeKey(keys[i + 1]);
			expect(compareKeys(a, b)).toBe(-1);
		}
	});

	it("negative zero < positive zero", () => {
		// In IndexedDB spec, -0 and 0 are treated as equal,
		// but our encoding distinguishes them for correctness
		const a = encodeKey(-0);
		const b = encodeKey(0);
		expect(compareKeys(a, b)).toBeLessThan(0);
	});

	it("strings are ordered lexicographically by UTF-16 code units", () => {
		const keys = ["", "a", "aa", "ab", "b"];
		for (let i = 0; i < keys.length - 1; i++) {
			const a = encodeKey(keys[i]);
			const b = encodeKey(keys[i + 1]);
			expect(compareKeys(a, b)).toBe(-1);
		}
	});

	it("type ordering: Number < Date < String < Binary < Array", () => {
		const number = encodeKey(0);
		const date = encodeKey(new Date(0));
		const string = encodeKey("");
		const binary = encodeKey(new ArrayBuffer(0));
		const array = encodeKey([]);

		expect(compareKeys(number, date)).toBe(-1);
		expect(compareKeys(date, string)).toBe(-1);
		expect(compareKeys(string, binary)).toBe(-1);
		expect(compareKeys(binary, array)).toBe(-1);
	});

	it("equal keys compare as 0", () => {
		expect(compareKeys(encodeKey(42), encodeKey(42))).toBe(0);
		expect(compareKeys(encodeKey("hello"), encodeKey("hello"))).toBe(0);
	});
});

/**
 * IndexedDB key encoding/decoding/validation/comparison.
 *
 * Order-preserving byte encoding so memcmp matches IndexedDB key ordering:
 *   Number < Date < String < Binary < Array
 *
 * Encoding format:
 *   Number (0x10): 8-byte IEEE 754 with sign-flip
 *   Date   (0x20): same as number (milliseconds since epoch)
 *   String (0x30): UTF-16 code units as 2-byte big-endian, 0x0000→0x00 0x01, terminated by 0x00 0x00
 *   Binary (0x40): 4-byte big-endian length + raw bytes
 *   Array  (0x50): recursively encoded elements, terminated by 0x00
 */

import {KeyType} from "./types.js";
import {DataError} from "./errors.js";

// ECMAScript IdentifierName: starts with letter/$/_/Unicode, followed by same + digits
const identifierPattern = /^[$_\p{L}][$_\p{L}\p{N}]*$/u;

/**
 * Validate a key path per the IDB spec.
 * Throws DOMException with name "SyntaxError" for invalid key paths.
 *
 * Valid key paths:
 *   - Empty string "" (value itself is the key)
 *   - Dotted identifiers: "foo", "foo.bar", "a.b.c"
 *   - Array of valid string key paths (non-empty, no nested arrays)
 *
 * Each identifier must be a valid ECMAScript IdentifierName.
 */
export function validateKeyPath(keyPath: unknown): void {
	if (typeof keyPath === "string") {
		validateStringKeyPath(keyPath);
		return;
	}
	if (Array.isArray(keyPath)) {
		if (keyPath.length === 0) {
			throw new DOMException(
				"The keyPath argument is an empty array",
				"SyntaxError",
			);
		}
		for (const element of keyPath) {
			// Web IDL stringifies non-string elements (e.g., ['x'] → "x")
			validateStringKeyPath(String(element));
		}
		return;
	}
	// Objects with toString() get converted
	if (keyPath != null && typeof keyPath === "object") {
		validateStringKeyPath(String(keyPath));
		return;
	}
	// null/undefined are valid (no key path)
	if (keyPath == null) return;

	throw new DOMException(
		"The keyPath argument is not valid",
		"SyntaxError",
	);
}

function validateStringKeyPath(keyPath: string): void {
	// Empty string is a valid key path
	if (keyPath === "") return;

	const parts = keyPath.split(".");
	for (const part of parts) {
		if (part === "" || !identifierPattern.test(part)) {
			throw new DOMException(
				`The keyPath "${keyPath}" contains an invalid identifier`,
				"SyntaxError",
			);
		}
	}
}

/**
 * Validate that a value is a valid IndexedDB key.
 * Returns the canonical key (e.g., Date → Date object).
 * Throws DataError for invalid keys.
 */
export function validateKey(value: unknown, seen?: Set<unknown>): IDBValidKey {
	if (typeof value === "number") {
		if (Number.isNaN(value)) {
			throw DataError("NaN is not a valid key");
		}
		return value;
	}
	if (typeof value === "string") {
		return value;
	}
	if (value instanceof Date) {
		const time = value.getTime();
		if (Number.isNaN(time)) {
			throw DataError("Invalid Date is not a valid key");
		}
		return value;
	}
	if (value instanceof ArrayBuffer) {
		// Check for detached ArrayBuffer
		if ((value as any).detached) {
			throw DataError("A detached ArrayBuffer is not a valid key");
		}
		return value;
	}
	if (ArrayBuffer.isView(value)) {
		// Check for detached TypedArray/DataView
		if ((value.buffer as any).detached) {
			throw DataError("A detached ArrayBuffer is not a valid key");
		}
		// Slice to get only the view's portion, not the entire backing buffer
		return (value.buffer as ArrayBuffer).slice(
			value.byteOffset,
			value.byteOffset + value.byteLength,
		);
	}
	if (Array.isArray(value)) {
		// Cycle detection
		if (!seen) seen = new Set();
		if (seen.has(value)) {
			throw DataError("Cyclic array key is not valid");
		}
		seen.add(value);
		// Validate each element recursively
		const result: IDBValidKey[] = [];
		for (const item of value) {
			result.push(validateKey(item, seen));
		}
		return result;
	}
	throw DataError(
		`The parameter is not a valid key (type: ${typeof value})`,
	);
}

/**
 * Encode a validated key into an order-preserving byte sequence.
 */
export function encodeKey(key: IDBValidKey): Uint8Array {
	const parts: number[] = [];
	encodeKeyInto(key, parts);
	return new Uint8Array(parts);
}

function encodeKeyInto(key: IDBValidKey, out: number[]): void {
	if (typeof key === "number") {
		out.push(KeyType.Number);
		encodeFloat64(key, out);
	} else if (typeof key === "string") {
		out.push(KeyType.String);
		encodeString(key, out);
	} else if (key instanceof Date) {
		out.push(KeyType.Date);
		encodeFloat64(key.getTime(), out);
	} else if (key instanceof ArrayBuffer) {
		out.push(KeyType.Binary);
		encodeBinary(new Uint8Array(key), out);
	} else if (Array.isArray(key)) {
		out.push(KeyType.Array);
		for (const item of key) {
			encodeKeyInto(item, out);
		}
		out.push(0x00); // array terminator
	}
}

/**
 * IEEE 754 sign-flip encoding for order-preserving comparison.
 * Positive: flip sign bit (XOR 0x80 on first byte)
 * Negative: flip all bits (XOR all bytes with 0xFF)
 * This ensures memcmp gives correct numeric ordering.
 */
function encodeFloat64(value: number, out: number[]): void {
	const buf = new ArrayBuffer(8);
	new DataView(buf).setFloat64(0, value, false); // big-endian
	const bytes = new Uint8Array(buf);

	if (value < 0 || Object.is(value, -0)) {
		// Negative: XOR all bytes
		for (let i = 0; i < 8; i++) {
			out.push(bytes[i] ^ 0xff);
		}
	} else {
		// Positive (including +0): XOR sign bit
		out.push(bytes[0] ^ 0x80);
		for (let i = 1; i < 8; i++) {
			out.push(bytes[i]);
		}
	}
}

/**
 * Decode a float64 from sign-flip encoding.
 */
function decodeFloat64(data: Uint8Array, offset: number): number {
	const bytes = new Uint8Array(8);

	// Check if this was a negative number: after sign-flip encoding,
	// the high bit of the first byte will be 0 for negative numbers
	if ((data[offset] & 0x80) === 0) {
		// Negative: was XOR'd with 0xFF
		for (let i = 0; i < 8; i++) {
			bytes[i] = data[offset + i] ^ 0xff;
		}
	} else {
		// Positive: was XOR'd with 0x80 on first byte
		bytes[0] = data[offset] ^ 0x80;
		for (let i = 1; i < 8; i++) {
			bytes[i] = data[offset + i];
		}
	}

	return new DataView(bytes.buffer).getFloat64(0, false);
}

/**
 * Encode a string as UTF-16 code units (big-endian).
 * 0x0000 is escaped as 0x00 0x01, terminated by 0x00 0x00.
 */
function encodeString(str: string, out: number[]): void {
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i);
		if (code === 0) {
			// Escape null as 0x00 0x01
			out.push(0x00, 0x01);
		} else {
			out.push((code >> 8) & 0xff, code & 0xff);
		}
	}
	// Terminator
	out.push(0x00, 0x00);
}

/**
 * Decode a string from the encoded form.
 * Returns [decoded string, bytes consumed including tag].
 */
function decodeString(
	data: Uint8Array,
	offset: number,
): [string, number] {
	const codes: number[] = [];
	let i = offset;
	while (i < data.length - 1) {
		const hi = data[i];
		const lo = data[i + 1];
		if (hi === 0x00 && lo === 0x00) {
			// Terminator
			i += 2;
			break;
		}
		if (hi === 0x00 && lo === 0x01) {
			// Escaped null
			codes.push(0);
			i += 2;
		} else {
			codes.push((hi << 8) | lo);
			i += 2;
		}
	}
	return [String.fromCharCode(...codes), i - offset];
}

/**
 * Encode binary data with byte stuffing for order-preserving comparison.
 * 0x00 bytes are escaped as 0x00 0x01, terminated by 0x00 0x00.
 * This ensures memcmp gives the same ordering as byte-by-byte comparison.
 */
function encodeBinary(bytes: Uint8Array, out: number[]): void {
	for (let i = 0; i < bytes.length; i++) {
		if (bytes[i] === 0x00) {
			out.push(0x00, 0x01); // escape null byte
		} else {
			out.push(bytes[i]);
		}
	}
	out.push(0x00, 0x00); // terminator
}

/**
 * Decode a key from its encoded byte representation.
 */
export function decodeKey(data: Uint8Array): IDBValidKey {
	const [key] = decodeKeyAt(data, 0);
	return key;
}

function decodeKeyAt(
	data: Uint8Array,
	offset: number,
): [IDBValidKey, number] {
	const tag = data[offset];
	offset++;

	switch (tag) {
		case KeyType.Number: {
			const value = decodeFloat64(data, offset);
			return [value, offset + 8];
		}
		case KeyType.Date: {
			const ms = decodeFloat64(data, offset);
			return [new Date(ms), offset + 8];
		}
		case KeyType.String: {
			const [str, consumed] = decodeString(data, offset);
			return [str, offset + consumed];
		}
		case KeyType.Binary: {
			const bytes: number[] = [];
			while (offset < data.length - 1) {
				if (data[offset] === 0x00 && data[offset + 1] === 0x00) {
					// Terminator
					offset += 2;
					break;
				}
				if (data[offset] === 0x00 && data[offset + 1] === 0x01) {
					// Escaped null byte
					bytes.push(0x00);
					offset += 2;
				} else {
					bytes.push(data[offset]);
					offset += 1;
				}
			}
			const buf = new Uint8Array(bytes).buffer;
			return [buf, offset];
		}
		case KeyType.Array: {
			const items: IDBValidKey[] = [];
			while (offset < data.length && data[offset] !== 0x00) {
				const [item, newOffset] = decodeKeyAt(data, offset);
				items.push(item);
				offset = newOffset;
			}
			// Skip array terminator
			offset++;
			return [items, offset];
		}
		default:
			throw DataError(`Unknown key type tag: 0x${tag.toString(16)}`);
	}
}

/**
 * Compare two encoded keys. Returns -1, 0, or 1.
 * Simple memcmp since the encoding is order-preserving.
 */
export function compareKeys(a: Uint8Array, b: Uint8Array): number {
	const len = Math.min(a.length, b.length);
	for (let i = 0; i < len; i++) {
		if (a[i] < b[i]) return -1;
		if (a[i] > b[i]) return 1;
	}
	if (a.length < b.length) return -1;
	if (a.length > b.length) return 1;
	return 0;
}

/**
 * Extract a key from a value using a key path.
 * Supports dotted paths and array key paths.
 */
export function extractKeyFromValue(
	value: unknown,
	keyPath: string | string[],
): IDBValidKey {
	if (Array.isArray(keyPath)) {
		return keyPath.map((p) => extractSingleKey(value, p));
	}
	return extractSingleKey(value, keyPath);
}

function extractSingleKey(value: unknown, path: string): IDBValidKey {
	if (path === "") {
		// Empty key path means the value itself is the key
		return validateKey(value);
	}
	const parts = path.split(".");
	let current: unknown = value;
	for (const part of parts) {
		if (current == null) {
			throw DataError(
				`Unable to extract key from value at path "${path}"`,
			);
		}
		// IDB spec: after cloning, only own properties exist on the clone.
		// For cloned plain objects, use hasOwnProperty to avoid prototype
		// getter side effects. For other objects (Blob, File, etc.),
		// use normal property access since their properties are on prototypes.
		const obj = current as Record<string, unknown>;
		if (Object.getPrototypeOf(obj) === Object.prototype || Array.isArray(obj)) {
			// Plain object or array — check own property only
			if (!Object.prototype.hasOwnProperty.call(obj, part)) {
				current = undefined;
			} else {
				current = obj[part];
			}
		} else {
			current = obj[part];
		}
	}
	return validateKey(current);
}

/**
 * Inject a key into a value at the given key path.
 * Mutates the value object. Only for single-string key paths.
 * Throws DataError if the value is not an object or if intermediate
 * segments point to non-objects that can't hold properties.
 */
export function injectKeyIntoValue(
	value: unknown,
	keyPath: string,
	key: IDBValidKey,
): void {
	if (value == null || typeof value !== "object") {
		throw DataError(
			`Cannot inject key into non-object value at path "${keyPath}"`,
		);
	}
	const parts = keyPath.split(".");
	let current: Record<string, unknown> = value as Record<string, unknown>;
	for (let i = 0; i < parts.length - 1; i++) {
		const next = current[parts[i]];
		if (next != null && typeof next !== "object") {
			throw DataError(
				`Cannot inject key at path "${keyPath}": "${parts.slice(0, i + 1).join(".")}" is not an object`,
			);
		}
		if (next == null) {
			current[parts[i]] = {};
		}
		current = current[parts[i]] as Record<string, unknown>;
	}
	current[parts[parts.length - 1]] = key;
}

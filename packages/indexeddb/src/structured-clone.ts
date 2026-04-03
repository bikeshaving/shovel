/**
 * Value serialization using the structured clone algorithm.
 *
 * Uses node:v8 serialize/deserialize (works in Node and Bun).
 */

import {serialize, deserialize} from "node:v8";

export function encodeValue(value: unknown): Uint8Array {
	return serialize(value);
}

export function decodeValue(data: Uint8Array): unknown {
	return deserialize(data);
}

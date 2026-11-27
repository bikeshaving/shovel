/**
 * IDBKeyRange implementation.
 */

import {encodeKey, validateKey, compareKeys} from "./key.js";
import {DataError} from "./errors.js";
import {kToSpec} from "./symbols.js";
import type {KeyRangeSpec, EncodedKey} from "./types.js";

export class IDBKeyRange {
	readonly lower: IDBValidKey | undefined;
	readonly upper: IDBValidKey | undefined;
	readonly lowerOpen: boolean;
	readonly upperOpen: boolean;

	#lowerEncoded: EncodedKey | undefined;
	#upperEncoded: EncodedKey | undefined;

	constructor(
		lower: IDBValidKey | undefined,
		upper: IDBValidKey | undefined,
		lowerOpen: boolean,
		upperOpen: boolean,
	) {
		this.lower = lower;
		this.upper = upper;
		this.lowerOpen = lowerOpen;
		this.upperOpen = upperOpen;

		if (lower !== undefined) {
			this.#lowerEncoded = encodeKey(lower);
		}
		if (upper !== undefined) {
			this.#upperEncoded = encodeKey(upper);
		}

		// Validate range: lower must be <= upper
		if (this.#lowerEncoded && this.#upperEncoded) {
			const cmp = compareKeys(this.#lowerEncoded, this.#upperEncoded);
			if (cmp > 0) {
				throw DataError("The lower key is greater than the upper key");
			}
			if (cmp === 0 && (lowerOpen || upperOpen)) {
				throw DataError(
					"The lower and upper keys are equal but one bound is open",
				);
			}
		}
	}

	/**
	 * Check if a key is within this range.
	 */
	includes(key: IDBValidKey): boolean {
		if (arguments.length === 0) {
			throw new TypeError(
				"Failed to execute 'includes' on 'IDBKeyRange': 1 argument required, but only 0 present.",
			);
		}
		const encoded = encodeKey(validateKey(key));
		return this.#includesEncoded(encoded);
	}

	#includesEncoded(encoded: EncodedKey): boolean {
		if (this.#lowerEncoded) {
			const cmp = compareKeys(encoded, this.#lowerEncoded);
			if (this.lowerOpen ? cmp <= 0 : cmp < 0) return false;
		}
		if (this.#upperEncoded) {
			const cmp = compareKeys(encoded, this.#upperEncoded);
			if (this.upperOpen ? cmp >= 0 : cmp > 0) return false;
		}
		return true;
	}

	/** @internal - Convert to backend spec */
	[kToSpec](): KeyRangeSpec {
		return {
			lower: this.#lowerEncoded,
			upper: this.#upperEncoded,
			lowerOpen: this.lowerOpen,
			upperOpen: this.upperOpen,
		};
	}

	static only(value: IDBValidKey): IDBKeyRange {
		const key = validateKey(value);
		return new IDBKeyRange(key, key, false, false);
	}

	static lowerBound(lower: IDBValidKey, open: boolean = false): IDBKeyRange {
		return new IDBKeyRange(validateKey(lower), undefined, open, true);
	}

	static upperBound(upper: IDBValidKey, open: boolean = false): IDBKeyRange {
		return new IDBKeyRange(undefined, validateKey(upper), true, open);
	}

	static bound(
		lower: IDBValidKey,
		upper: IDBValidKey,
		lowerOpen: boolean = false,
		upperOpen: boolean = false,
	): IDBKeyRange {
		if (arguments.length < 2) {
			throw new TypeError(
				"Failed to execute 'bound' on 'IDBKeyRange': 2 arguments required, but only " +
					arguments.length +
					" present.",
			);
		}
		return new IDBKeyRange(
			validateKey(lower),
			validateKey(upper),
			lowerOpen,
			upperOpen,
		);
	}
}

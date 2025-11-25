import {test, expect, describe} from "bun:test";
import {MatchPattern, URLPattern} from "../src/index.js";
import testData from "./urlpatterntestdata.json";

describe("WPT URLPattern (strict) compliance", () => {
	for (let i = 0; i < testData.length; i++) {
		const testCase = testData[i] as {
			pattern?: unknown[];
			inputs?: unknown[];
			expected_obj?: unknown;
			expected_match?: unknown;
		};

		// Skip tests with no pattern
		if (!testCase.pattern) continue;

		const patternDesc = JSON.stringify(testCase.pattern);

		test(`#${i}: ${patternDesc.slice(0, 60)}${patternDesc.length > 60 ? "..." : ""}`, () => {
			const shouldThrow = testCase.expected_obj === "error";

			let pattern: URLPattern | undefined;
			let constructionError: Error | undefined;

			try {
				if (Array.isArray(testCase.pattern)) {
					if (testCase.pattern.length === 3) {
						const [input, second, third] = testCase.pattern;
						if (typeof second === "string") {
							pattern = new URLPattern(
								input as string,
								second,
								third as {ignoreCase?: boolean},
							);
						} else {
							throw new TypeError(
								"Invalid arguments: expected (string, baseURL, options)",
							);
						}
					} else if (testCase.pattern.length === 2) {
						pattern = new URLPattern(
							testCase.pattern[0] as string,
							testCase.pattern[1] as string | {ignoreCase?: boolean},
						);
					} else {
						pattern = new URLPattern(testCase.pattern[0] as string);
					}
				}
			} catch (e) {
				constructionError = e as Error;
			}

			if (shouldThrow) {
				expect(constructionError).toBeDefined();
				return;
			}

			expect(constructionError).toBeUndefined();
			expect(pattern).toBeDefined();

			// If no inputs, just testing construction
			if (!testCase.inputs) return;

			const shouldMatch = testCase.expected_match !== null;
			const result = pattern!.test(...(testCase.inputs as [unknown, unknown?]));
			expect(result).toBe(shouldMatch);
		});
	}
});

describe("WPT MatchPattern (conveniences) compliance", () => {
	// Tests that are intentionally skipped because MatchPattern allows relative patterns
	// without baseURL (a convenience feature that differs from strict URLPattern spec)
	const skippedTests = new Set([214, 215]);

	for (let i = 0; i < testData.length; i++) {
		const testCase = testData[i] as {
			pattern?: unknown[];
			inputs?: unknown[];
			expected_obj?: unknown;
			expected_match?: unknown;
		};

		// Skip tests with no pattern
		if (!testCase.pattern) continue;

		// Skip intentionally non-compliant tests
		if (skippedTests.has(i)) continue;

		const patternDesc = JSON.stringify(testCase.pattern);

		test(`#${i}: ${patternDesc.slice(0, 60)}${patternDesc.length > 60 ? "..." : ""}`, () => {
			const shouldThrow = testCase.expected_obj === "error";

			let pattern: MatchPattern | undefined;
			let constructionError: Error | undefined;

			try {
				if (Array.isArray(testCase.pattern)) {
					if (testCase.pattern.length === 3) {
						// Per URLPattern spec: new URLPattern(input, baseURL, options)
						// input: string, baseURL: string, options: object
						// If second arg is not a string, it's invalid
						const [input, second, third] = testCase.pattern;
						if (typeof second === "string") {
							// [input, baseURL, options]
							pattern = new MatchPattern(
								input as string,
								second,
								third as {ignoreCase?: boolean},
							);
						} else {
							// Invalid: [input, options, ???] - third arg not expected
							throw new TypeError(
								"Invalid arguments: expected (string, baseURL, options)",
							);
						}
					} else if (testCase.pattern.length === 2) {
						// [input, baseURLOrOptions]
						pattern = new MatchPattern(
							testCase.pattern[0] as string,
							testCase.pattern[1] as string | {ignoreCase?: boolean},
						);
					} else {
						pattern = new MatchPattern(testCase.pattern[0] as string);
					}
				}
			} catch (e) {
				constructionError = e as Error;
			}

			if (shouldThrow) {
				expect(constructionError).toBeDefined();
				return;
			}

			expect(constructionError).toBeUndefined();
			expect(pattern).toBeDefined();

			// If no inputs, just testing construction
			if (!testCase.inputs) return;

			const shouldMatch = testCase.expected_match !== null;
			const result = pattern!.test(...(testCase.inputs as [unknown, unknown?]));
			expect(result).toBe(shouldMatch);
		});
	}
});

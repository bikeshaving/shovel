import {test, expect, describe} from "bun:test";
import {MatchPattern} from "../src/index.js";
import testData from "./urlpatterntestdata.json";

describe("WPT URLPattern compliance", () => {
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

			let pattern: MatchPattern | undefined;
			let constructionError: Error | undefined;

			try {
				if (Array.isArray(testCase.pattern)) {
					if (testCase.pattern.length === 3) {
						// [input, baseURL, options]
						pattern = new MatchPattern(
							testCase.pattern[0] as string,
							testCase.pattern[1] as string,
							testCase.pattern[2] as {ignoreCase?: boolean},
						);
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

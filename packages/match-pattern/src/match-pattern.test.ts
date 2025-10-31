import {test, expect, describe} from "bun:test";
import * as URL_builtin from "url";

// Get URLPattern for comparison tests
let URLPattern: typeof globalThis.URLPattern =
	URL_builtin.URLPattern || globalThis.URLPattern;
if (!URLPattern) {
	await import("urlpattern-polyfill");
	URLPattern = globalThis.URLPattern;
}

// Import our MatchPattern
import {MatchPattern, type MatchPatternResult} from "./match-pattern.js";

describe("MatchPattern vs URLPattern", () => {
	describe("Search Parameter Matching", () => {
		test("URLPattern fails with different parameter order", () => {
			const pattern: URLPattern = new URLPattern({
				pathname: "/api/posts",
				search: "type=blog&sort=date",
			});
			const url1: URL = new URL(
				"http://example.com/api/posts?type=blog&sort=date",
			);
			const url2: URL = new URL(
				"http://example.com/api/posts?sort=date&type=blog",
			);

			expect(pattern.test(url1)).toBe(true);
			expect(pattern.test(url2)).toBe(false); // This is the problem!
		});

		test("URLPattern fails with extra parameters", () => {
			const pattern: URLPattern = new URLPattern({
				pathname: "/api/posts",
				search: "type=blog&sort=date",
			});
			const url: URL = new URL(
				"http://example.com/api/posts?type=blog&sort=date&extra=value",
			);

			expect(pattern.test(url)).toBe(false); // Should be true for flexible routing
		});

		// TODO: MatchPattern should fix these issues
		test("MatchPattern handles different parameter order", () => {
			const pattern: MatchPattern = new MatchPattern({
				pathname: "/api/posts",
				search: "type=:type&sort=:sort",
			});
			const url1: URL = new URL(
				"http://example.com/api/posts?type=blog&sort=date",
			);
			const url2: URL = new URL(
				"http://example.com/api/posts?sort=date&type=blog",
			);

			expect(pattern.test(url1)).toBe(true);
			expect(pattern.test(url2)).toBe(true); // MatchPattern should handle this
		});

		test("MatchPattern allows extra parameters", () => {
			const pattern: MatchPattern = new MatchPattern({
				pathname: "/api/posts",
				search: "type=:type&sort=:sort",
			});
			const url: URL = new URL(
				"http://example.com/api/posts?type=blog&sort=date&extra=value",
			);

			expect(pattern.test(url)).toBe(true); // MatchPattern should be flexible
		});
	});

	describe("String Parameter Parsing", () => {
		test("URLPattern string constructor requires base URL", () => {
			expect(() => {
				new URLPattern("/api/posts/:id");
			}).toThrow("A base URL must be provided");
		});

		test("MatchPattern should support string patterns", () => {
			const pattern: MatchPattern = new MatchPattern("/api/posts/:id");
			const url: URL = new URL("http://example.com/api/posts/123");

			expect(pattern.test(url)).toBe(true);
			const result: MatchPatternResult | null = pattern.exec(url);
			expect(result?.params.id).toBe("123");
		});

		test("MatchPattern should support full URL strings", () => {
			const pattern: MatchPattern = new MatchPattern(
				"https://api.example.com/v1/posts/:id",
			);
			const url: URL = new URL("https://api.example.com/v1/posts/123");

			expect(pattern.test(url)).toBe(true);
			const result: MatchPatternResult | null = pattern.exec(url);
			expect(result?.params.id).toBe("123");
		});
	});

	describe("Parameter Merging", () => {
		test("URLPattern keeps pathname and search params separate", () => {
			const pattern: URLPattern = new URLPattern({
				pathname: "/api/:version/posts/:id",
				search: "format=:format",
			});
			const url: URL = new URL(
				"http://example.com/api/v1/posts/123?format=json",
			);
			const result: URLPatternResult | null = pattern.exec(url);

			// URLPattern separates them
			expect(result?.pathname?.groups).toEqual({version: "v1", id: "123"});
			expect(result?.search?.groups).toEqual({format: "json"});

			// No unified params object
			expect(result?.params).toBeUndefined();
		});

		test("MatchPattern should merge all parameters", () => {
			const pattern: MatchPattern = new MatchPattern({
				pathname: "/api/:version/posts/:id",
				search: "format=:format",
			});
			const url: URL = new URL(
				"http://example.com/api/v1/posts/123?format=json&page=1",
			);
			const result: MatchPatternResult | null = pattern.exec(url);

			// MatchPattern should provide unified params
			expect(result?.params).toEqual({
				version: "v1",
				id: "123",
				format: "json",
				page: "1", // Extra parameters included
			});
		});
	});

	describe("Enhanced Routing Features", () => {
		test("MatchPattern should support non-exhaustive search matching", () => {
			const pattern: MatchPattern = new MatchPattern({
				pathname: "/search",
				search: "q=:query",
			});
			const url1: URL = new URL("http://example.com/search?q=hello");
			const url2: URL = new URL("http://example.com/search?q=hello&page=1");
			const url3: URL = new URL(
				"http://example.com/search?q=hello&page=1&limit=10",
			);

			expect(pattern.test(url1)).toBe(true);
			expect(pattern.test(url2)).toBe(true);
			expect(pattern.test(url3)).toBe(true);
		});

		test.todo("MatchPattern should provide rich string parameter API", () => {
			// // Should work with pathname-only patterns
			// const pattern1 = new MatchPattern('/api/posts/:id');
			//
			// // Should work with full URL patterns
			// const pattern2 = new MatchPattern('https://api.example.com/v1/posts/:id');
			//
			// // Should work with mixed patterns
			// const pattern3 = new MatchPattern('/search?q=:query&page=:page');
		});

		test("MatchPattern should handle order-independent search params", () => {
			const pattern: MatchPattern = new MatchPattern({
				pathname: "/test",
				search: "type=:type&sort=:sort",
			});
			const url1: URL = new URL("http://example.com/test?type=blog&sort=date");
			const url2: URL = new URL("http://example.com/test?sort=date&type=blog");

			expect(pattern.test(url1)).toBe(true);
			expect(pattern.test(url2)).toBe(true);

			const result1: MatchPatternResult | null = pattern.exec(url1);
			const result2: MatchPatternResult | null = pattern.exec(url2);

			expect(result1?.params).toEqual({type: "blog", sort: "date"});
			expect(result2?.params).toEqual({type: "blog", sort: "date"});
		});
	});
});

describe("MatchPattern API Design", () => {
	test("should be a subclass of URLPattern", () => {
		const pattern: MatchPattern = new MatchPattern("/api/posts/:id");
		expect(pattern instanceof URLPattern).toBe(true);
	});

	test.todo("should have enhanced exec() method", () => {
		// const pattern = new MatchPattern('/api/:version/posts/:id?format=:format');
		// const url = new URL('http://example.com/api/v1/posts/123?format=json&page=1');
		// const result = pattern.exec(url);
		//
		// expect(result).toEqual({
		//   params: {
		//     version: 'v1',
		//     id: '123',
		//     format: 'json',
		//     page: '1'
		//   },
		//   pathname: { groups: { version: 'v1', id: '123' } },
		//   search: { groups: { format: 'json' } },
		//   // ... other URLPattern exec result properties
		// });
	});

	test("should support convenience pattern formats", () => {
		// Pathname only
		const pattern1: MatchPattern = new MatchPattern("/api/posts/:id");
		expect(pattern1.pathname).toBe("/api/posts/:id");

		// With search params using & syntax
		const pattern2: MatchPattern = new MatchPattern(
			"/api/posts/:id&format=:format",
		);
		expect(pattern2.pathname).toBe("/api/posts/:id");
		expect(pattern2.search).toBe("format=:format");

		// Search params only
		const pattern3: MatchPattern = new MatchPattern("&q=:query&page=:page");
		expect(pattern3.search).toBe("q=:query&page=:page");

		// Object format (same as URLPattern)
		const pattern4: MatchPattern = new MatchPattern({
			pathname: "/api/posts/:id",
			search: "format=:format",
		});
		expect(pattern4.pathname).toBe("/api/posts/:id");
		expect(pattern4.search).toBe("format=:format");
	});

	test("should match URLs with & syntax patterns", () => {
		const pattern: MatchPattern = new MatchPattern(
			"/api/posts/:id&format=:format",
		);
		const url: URL = new URL("http://example.com/api/posts/123?format=json");

		expect(pattern.test(url)).toBe(true);
		const result: MatchPatternResult | null = pattern.exec(url);
		expect(result?.params).toEqual({id: "123", format: "json"});
	});
});

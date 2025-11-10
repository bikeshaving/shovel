import {test, expect, describe} from "bun:test";

import {MatchPattern} from "../dist/src/index.js";

describe("MatchPattern", () => {
	test("should be a subclass of URLPattern", () => {
		const pattern = new MatchPattern("/api/posts/:id");
		expect(pattern instanceof URLPattern).toBe(true);
	});

	test("should support string patterns", () => {
		const pattern = new MatchPattern("/api/posts/:id");
		const url = new URL("http://example.com/api/posts/123");

		expect(pattern.test(url)).toBe(true);
		const result = pattern.exec(url);
		expect(result?.params.id).toBe("123");
	});

	test("should support full URL strings", () => {
		const pattern = new MatchPattern("https://api.example.com/v1/posts/:id");
		const url = new URL("https://api.example.com/v1/posts/123");

		expect(pattern.test(url)).toBe(true);
		const result = pattern.exec(url);
		expect(result?.params.id).toBe("123");
	});

	test("should handle different parameter order", () => {
		const pattern = new MatchPattern({
			pathname: "/api/posts",
			search: "type=:type&sort=:sort",
		});
		const url1 = new URL("http://example.com/api/posts?type=blog&sort=date");
		const url2 = new URL("http://example.com/api/posts?sort=date&type=blog");

		expect(pattern.test(url1)).toBe(true);
		expect(pattern.test(url2)).toBe(true);
	});

	test("should allow extra parameters", () => {
		const pattern = new MatchPattern({
			pathname: "/api/posts",
			search: "type=:type&sort=:sort",
		});
		const url = new URL(
			"http://example.com/api/posts?type=blog&sort=date&extra=value",
		);

		expect(pattern.test(url)).toBe(true);
	});

	test("should merge all parameters", () => {
		const pattern = new MatchPattern({
			pathname: "/api/:version/posts/:id",
			search: "format=:format",
		});
		const url = new URL(
			"http://example.com/api/v1/posts/123?format=json&page=1",
		);
		const result = pattern.exec(url);

		expect(result?.params).toEqual({
			version: "v1",
			id: "123",
			format: "json",
			page: "1",
		});
	});

	test("should support & syntax patterns", () => {
		const pattern = new MatchPattern("/api/posts/:id&format=:format");
		const url = new URL("http://example.com/api/posts/123?format=json");

		expect(pattern.test(url)).toBe(true);
		const result = pattern.exec(url);
		expect(result?.params).toEqual({id: "123", format: "json"});
	});

	test("should support search-only patterns", () => {
		const pattern = new MatchPattern("&q=:query&page=:page");
		expect(pattern.search).toBe("q=:query&page=:page");
	});
});

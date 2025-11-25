import {test, expect, describe} from "bun:test";

import {MatchPattern} from "../src/index.js";

describe("MatchPattern", () => {
	test("should be instantiable", () => {
		const pattern = new MatchPattern("/api/posts/:id");
		expect(pattern).toBeInstanceOf(MatchPattern);
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

describe("URLPattern Spec Compliance", () => {
	describe("Named parameters", () => {
		test("basic named parameter", () => {
			const pattern = new MatchPattern("/users/:id");
			expect(pattern.test(new URL("http://localhost/users/123"))).toBe(true);
			expect(pattern.test(new URL("http://localhost/users/abc"))).toBe(true);
			expect(pattern.test(new URL("http://localhost/users"))).toBe(false);

			const result = pattern.exec(new URL("http://localhost/users/123"));
			expect(result?.params.id).toBe("123");
		});

		test("multiple named parameters", () => {
			const pattern = new MatchPattern("/api/:version/posts/:id");
			expect(pattern.test(new URL("http://localhost/api/v1/posts/123"))).toBe(
				true,
			);

			const result = pattern.exec(new URL("http://localhost/api/v1/posts/123"));
			expect(result?.params.version).toBe("v1");
			expect(result?.params.id).toBe("123");
		});

		test("named parameter with regex constraint", () => {
			const pattern = new MatchPattern("/users/:id(\\d+)");
			expect(pattern.test(new URL("http://localhost/users/123"))).toBe(true);
			expect(pattern.test(new URL("http://localhost/users/abc"))).toBe(false);

			const result = pattern.exec(new URL("http://localhost/users/456"));
			expect(result?.params.id).toBe("456");
		});
	});

	describe("Optional parameters (?)", () => {
		test("optional named parameter", () => {
			const pattern = new MatchPattern("/users/:id?");
			expect(pattern.test(new URL("http://localhost/users"))).toBe(true);
			expect(pattern.test(new URL("http://localhost/users/123"))).toBe(true);
			expect(pattern.test(new URL("http://localhost/users/"))).toBe(false);
		});

		test("optional parameter with value", () => {
			const pattern = new MatchPattern("/users/:id?");
			const result = pattern.exec(new URL("http://localhost/users/123"));
			expect(result?.params.id).toBe("123");
		});

		test("optional parameter without value", () => {
			const pattern = new MatchPattern("/users/:id?");
			const result = pattern.exec(new URL("http://localhost/users"));
			// URLPattern returns undefined for optional params with no value
			expect(result?.params.id).toBeUndefined();
		});
	});

	describe("One or more (+)", () => {
		test("one or more requires at least one", () => {
			const pattern = new MatchPattern("/files/:path+");
			expect(pattern.test(new URL("http://localhost/files"))).toBe(false);
			expect(pattern.test(new URL("http://localhost/files/doc"))).toBe(true);
			expect(pattern.test(new URL("http://localhost/files/doc/file"))).toBe(
				true,
			);
		});

		test("one or more captures value", () => {
			const pattern = new MatchPattern("/files/:path+");
			const result = pattern.exec(new URL("http://localhost/files/doc"));
			expect(result?.params.path).toBe("doc");
		});
	});

	describe("Zero or more (*)", () => {
		test("zero or more allows empty", () => {
			const pattern = new MatchPattern("/files/:path*");
			expect(pattern.test(new URL("http://localhost/files"))).toBe(true);
			expect(pattern.test(new URL("http://localhost/files/doc"))).toBe(true);
			expect(pattern.test(new URL("http://localhost/files/doc/file"))).toBe(
				true,
			);
			expect(pattern.test(new URL("http://localhost/files/"))).toBe(false);
		});

		test("zero or more with empty captures undefined", () => {
			const pattern = new MatchPattern("/files/:path*");
			const result = pattern.exec(new URL("http://localhost/files"));
			// URLPattern returns undefined for zero-or-more with no value
			expect(result?.params.path).toBeUndefined();
		});

		test("zero or more with value", () => {
			const pattern = new MatchPattern("/files/:path*");
			const result = pattern.exec(new URL("http://localhost/files/doc"));
			expect(result?.params.path).toBe("doc");
		});
	});

	describe("Wildcards", () => {
		test("wildcard matches anything", () => {
			const pattern = new MatchPattern("/files/*");
			expect(pattern.test(new URL("http://localhost/files/doc.txt"))).toBe(
				true,
			);
			expect(pattern.test(new URL("http://localhost/files/a/b/c"))).toBe(true);
		});

		test("wildcard captures value", () => {
			const pattern = new MatchPattern("/files/*");
			const result = pattern.exec(new URL("http://localhost/files/doc.txt"));
			// URLPattern uses numbered groups for wildcards
			expect(result?.params["0"]).toBe("doc.txt");
		});
	});

	describe("Regex groups", () => {
		test("regex group with constraint", () => {
			const pattern = new MatchPattern("/users/(\\d+)");
			expect(pattern.test(new URL("http://localhost/users/123"))).toBe(true);
			expect(pattern.test(new URL("http://localhost/users/abc"))).toBe(false);
		});

		test("regex group captures value", () => {
			const pattern = new MatchPattern("/users/(\\d+)");
			const result = pattern.exec(new URL("http://localhost/users/123"));
			expect(result?.params.$0).toBe("123");
		});

		test("multiple regex groups", () => {
			const pattern = new MatchPattern("/api/(v\\d+)/posts/(\\d+)");
			expect(pattern.test(new URL("http://localhost/api/v1/posts/123"))).toBe(
				true,
			);
			expect(pattern.test(new URL("http://localhost/api/v1/posts/abc"))).toBe(
				false,
			);

			const result = pattern.exec(new URL("http://localhost/api/v1/posts/123"));
			expect(result?.params.$0).toBe("v1");
			expect(result?.params.$1).toBe("123");
		});
	});

	describe("Explicit delimiters {...}", () => {
		test("optional explicit delimiter", () => {
			const pattern = new MatchPattern("/books{/old}?");
			expect(pattern.test(new URL("http://localhost/books"))).toBe(true);
			expect(pattern.test(new URL("http://localhost/books/old"))).toBe(true);
			expect(pattern.test(new URL("http://localhost/books/new"))).toBe(false);
		});

		test("explicit delimiter with parameter", () => {
			const pattern = new MatchPattern("/users{/:id}?");
			expect(pattern.test(new URL("http://localhost/users"))).toBe(true);
			expect(pattern.test(new URL("http://localhost/users/123"))).toBe(true);
		});
	});

	describe("Escaped characters", () => {
		test("escaped dot", () => {
			const pattern = new MatchPattern("/api/v1\\.0");
			expect(pattern.test(new URL("http://localhost/api/v1.0"))).toBe(true);
			expect(pattern.test(new URL("http://localhost/api/v1x0"))).toBe(false);
		});

		test("escaped special characters", () => {
			const pattern = new MatchPattern("/path\\+with\\+plus");
			expect(pattern.test(new URL("http://localhost/path+with+plus"))).toBe(
				true,
			);
			expect(pattern.test(new URL("http://localhost/pathxwithxplus"))).toBe(
				false,
			);
		});
	});

	describe("Combined features", () => {
		test("named params with regex and constraints", () => {
			const pattern = new MatchPattern("/api/:version(v\\d+)/posts/:id(\\d+)");
			expect(pattern.test(new URL("http://localhost/api/v1/posts/123"))).toBe(
				true,
			);
			expect(pattern.test(new URL("http://localhost/api/v1/posts/abc"))).toBe(
				false,
			);
			expect(pattern.test(new URL("http://localhost/api/x1/posts/123"))).toBe(
				false,
			);

			const result = pattern.exec(new URL("http://localhost/api/v2/posts/456"));
			expect(result?.params.version).toBe("v2");
			expect(result?.params.id).toBe("456");
		});

		test("optional params with constraints", () => {
			const pattern = new MatchPattern("/users/:id(\\d+)?");
			expect(pattern.test(new URL("http://localhost/users"))).toBe(true);
			expect(pattern.test(new URL("http://localhost/users/123"))).toBe(true);
			expect(pattern.test(new URL("http://localhost/users/abc"))).toBe(false);
		});
	});

	describe("Protocol and hostname matching", () => {
		test("protocol matching", () => {
			const pattern = new MatchPattern({
				protocol: "https",
				pathname: "/api/posts",
			});
			expect(pattern.test(new URL("https://example.com/api/posts"))).toBe(true);
			expect(pattern.test(new URL("http://example.com/api/posts"))).toBe(false);
		});

		test("hostname matching", () => {
			const pattern = new MatchPattern({
				hostname: "api.example.com",
				pathname: "/posts",
			});
			expect(pattern.test(new URL("http://api.example.com/posts"))).toBe(true);
			expect(pattern.test(new URL("http://example.com/posts"))).toBe(false);
		});

		test("full URL pattern string", () => {
			const pattern = new MatchPattern("https://api.example.com/posts/:id");
			expect(pattern.test(new URL("https://api.example.com/posts/123"))).toBe(
				true,
			);
			expect(pattern.test(new URL("http://api.example.com/posts/123"))).toBe(
				false,
			);
			expect(pattern.test(new URL("https://example.com/posts/123"))).toBe(
				false,
			);
		});
	});

	describe("Static paths", () => {
		test("exact match", () => {
			const pattern = new MatchPattern("/api/posts");
			expect(pattern.test(new URL("http://localhost/api/posts"))).toBe(true);
			expect(pattern.test(new URL("http://localhost/api/post"))).toBe(false);
			expect(pattern.test(new URL("http://localhost/api/posts/123"))).toBe(
				false,
			);
		});

		test("root path", () => {
			const pattern = new MatchPattern("/");
			expect(pattern.test(new URL("http://localhost/"))).toBe(true);
			expect(pattern.test(new URL("http://localhost/home"))).toBe(false);
		});
	});
});

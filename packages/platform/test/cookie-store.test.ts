/**
 * Cookie Store API Tests
 */

import {describe, it, expect} from "bun:test";
import {
	RequestCookieStore,
	parseCookieHeader,
	serializeCookie,
	parseSetCookieHeader,
} from "../src/runtime.js";

describe("Cookie Parsing", () => {
	it("should parse Cookie header", () => {
		const cookies = parseCookieHeader("session=abc123; user=john");
		expect(cookies.get("session")).toBe("abc123");
		expect(cookies.get("user")).toBe("john");
	});

	it("should handle empty Cookie header", () => {
		const cookies = parseCookieHeader("");
		expect(cookies.size).toBe(0);
	});

	it("should handle cookies with = in value", () => {
		const cookies = parseCookieHeader("token=Bearer=xyz123");
		expect(cookies.get("token")).toBe("Bearer=xyz123");
	});

	it("should decode URL-encoded values", () => {
		const cookies = parseCookieHeader("name=John%20Doe");
		expect(cookies.get("name")).toBe("John Doe");
	});
});

describe("Cookie Serialization", () => {
	it("should serialize basic cookie", () => {
		const header = serializeCookie({
			name: "session",
			value: "abc123",
		});
		expect(header).toContain("session=abc123");
		expect(header).toContain("Path=/");
		expect(header).toContain("SameSite=Strict");
		expect(header).toContain("Secure");
	});

	it("should serialize cookie with all options", () => {
		const header = serializeCookie({
			name: "session",
			value: "abc123",
			domain: "example.com",
			path: "/app",
			expires: Date.now() + 3600000,
			sameSite: "lax",
			partitioned: true,
		});
		expect(header).toContain("session=abc123");
		expect(header).toContain("Domain=example.com");
		expect(header).toContain("Path=/app");
		expect(header).toContain("Expires=");
		expect(header).toContain("SameSite=Lax");
		expect(header).toContain("Partitioned");
		expect(header).toContain("Secure");
	});

	it("should encode special characters", () => {
		const header = serializeCookie({
			name: "data",
			value: "hello world",
		});
		expect(header).toContain("data=hello%20world");
	});
});

describe("Set-Cookie Parsing", () => {
	it("should parse Set-Cookie header", () => {
		const cookie = parseSetCookieHeader(
			"session=abc123; Path=/; Secure; SameSite=Strict",
		);
		expect(cookie.name).toBe("session");
		expect(cookie.value).toBe("abc123");
		expect(cookie.path).toBe("/");
		expect(cookie.secure).toBe(true);
		expect(cookie.sameSite).toBe("strict");
	});

	it("should parse cookie with Expires", () => {
		const expireDate = new Date(Date.now() + 3600000).toUTCString();
		const cookie = parseSetCookieHeader(
			`session=abc123; Expires=${expireDate}`,
		);
		expect(cookie.expires).toBeGreaterThan(Date.now());
	});

	it("should parse cookie with Max-Age", () => {
		const cookie = parseSetCookieHeader("session=abc123; Max-Age=3600");
		expect(cookie.expires).toBeGreaterThan(Date.now());
	});
});

describe("RequestCookieStore", () => {
	it("should create empty store", () => {
		const store = new RequestCookieStore();
		expect(store).toBeDefined();
	});

	it("should parse cookies from request", async () => {
		const request = new Request("https://example.com", {
			headers: {
				Cookie: "session=abc123; user=john",
			},
		});
		const store = new RequestCookieStore(request);

		const session = await store.get("session");
		expect(session?.value).toBe("abc123");

		const user = await store.get("user");
		expect(user?.value).toBe("john");
	});

	it("should get all cookies", async () => {
		const request = new Request("https://example.com", {
			headers: {
				Cookie: "a=1; b=2; c=3",
			},
		});
		const store = new RequestCookieStore(request);

		const all = await store.getAll();
		expect(all.length).toBe(3);
		expect(all.map((c) => c.name).sort()).toEqual(["a", "b", "c"]);
	});

	it("should filter cookies by name", async () => {
		const request = new Request("https://example.com", {
			headers: {
				Cookie: "a=1; b=2; c=3",
			},
		});
		const store = new RequestCookieStore(request);

		const filtered = await store.getAll("b");
		expect(filtered.length).toBe(1);
		expect(filtered[0].name).toBe("b");
		expect(filtered[0].value).toBe("2");
	});

	it("should set cookie", async () => {
		const store = new RequestCookieStore();
		await store.set("new", "value");

		const cookie = await store.get("new");
		expect(cookie?.value).toBe("value");
	});

	it("should set cookie with options", async () => {
		const store = new RequestCookieStore();
		await store.set({
			name: "session",
			value: "abc123",
			domain: "example.com",
			path: "/app",
			sameSite: "lax",
		});

		const cookie = await store.get("session");
		expect(cookie?.value).toBe("abc123");
		expect(cookie?.domain).toBe("example.com");
		expect(cookie?.path).toBe("/app");
		expect(cookie?.sameSite).toBe("lax");
	});

	it("should delete cookie", async () => {
		const request = new Request("https://example.com", {
			headers: {
				Cookie: "session=abc123",
			},
		});
		const store = new RequestCookieStore(request);

		let cookie = await store.get("session");
		expect(cookie?.value).toBe("abc123");

		await store.delete("session");
		cookie = await store.get("session");
		expect(cookie).toBeNull();
	});

	it("should track changes", async () => {
		const store = new RequestCookieStore();
		expect(store.hasChanges()).toBe(false);

		await store.set("new", "value");
		expect(store.hasChanges()).toBe(true);
	});

	it("should generate Set-Cookie headers", async () => {
		const store = new RequestCookieStore();
		await store.set("a", "1");
		await store.set("b", "2");

		const headers = store.getSetCookieHeaders();
		expect(headers.length).toBe(2);
		expect(headers[0]).toContain("a=1");
		expect(headers[1]).toContain("b=2");
	});

	it("should generate delete Set-Cookie header", async () => {
		const request = new Request("https://example.com", {
			headers: {
				Cookie: "session=abc123",
			},
		});
		const store = new RequestCookieStore(request);

		await store.delete("session");
		const headers = store.getSetCookieHeaders();
		expect(headers.length).toBe(1);
		expect(headers[0]).toContain("session=");
		expect(headers[0]).toContain("Expires=Thu, 01 Jan 1970");
	});

	it("should throw on cookie name+value too large", async () => {
		const store = new RequestCookieStore();
		const largeValue = "x".repeat(4097);

		await expect(store.set("test", largeValue)).rejects.toThrow(
			"Cookie name+value too large",
		);
	});
});

/**
 * Cookie Store API Tests
 *
 * Tests based on WPT cookiestore/ tests:
 * - cookieStore_get_set_basic.https.any.js
 * - cookieStore_delete_basic.https.any.js
 * - cookieStore_getAll_set_basic.https.any.js
 * - cookieStore_get_arguments.https.any.js
 * - cookieStore_set_arguments.https.any.js
 */

import {describe, test, expect, beforeEach} from "bun:test";
import {RequestCookieStore} from "../../platform/src/cookie-store.js";

describe("Cookie Store API", () => {
	let cookieStore: RequestCookieStore;

	beforeEach(() => {
		// Create a fresh cookie store for each test
		cookieStore = new RequestCookieStore();
	});

	// ==========================================================================
	// Basic get/set tests (cookieStore_get_set_basic.https.any.js)
	// ==========================================================================
	describe("cookieStore.get and cookieStore.set basic", () => {
		test("cookieStore.get returns the cookie written by cookieStore.set", async () => {
			await cookieStore.set("cookie-name", "cookie-value");
			const cookie = await cookieStore.get("cookie-name");

			expect(cookie?.name).toBe("cookie-name");
			expect(cookie?.value).toBe("cookie-value");
		});
	});

	// ==========================================================================
	// Delete tests (cookieStore_delete_basic.https.any.js)
	// ==========================================================================
	describe("cookieStore.delete", () => {
		test("cookieStore.delete return type is Promise<void>", async () => {
			const p = cookieStore.delete("cookie-name");
			expect(p).toBeInstanceOf(Promise);
			const result = await p;
			expect(result).toBeUndefined();
		});

		test("cookieStore.delete removes a cookie", async () => {
			await cookieStore.set("cookie-name", "cookie-value");
			let cookie = await cookieStore.get("cookie-name");
			expect(cookie?.value).toBe("cookie-value");

			await cookieStore.delete("cookie-name");
			cookie = await cookieStore.get("cookie-name");
			expect(cookie).toBeNull();
		});
	});

	// ==========================================================================
	// getAll tests (cookieStore_getAll_set_basic.https.any.js)
	// ==========================================================================
	describe("cookieStore.getAll", () => {
		test("cookieStore.getAll returns the cookie written by cookieStore.set", async () => {
			await cookieStore.set("cookie-name", "cookie-value");
			const cookies = await cookieStore.getAll("cookie-name");

			expect(cookies.length).toBe(1);
			expect(cookies[0].name).toBe("cookie-name");
			expect(cookies[0].value).toBe("cookie-value");
		});

		test("cookieStore.getAll returns all cookies when no filter", async () => {
			await cookieStore.set("cookie-1", "value-1");
			await cookieStore.set("cookie-2", "value-2");
			const cookies = await cookieStore.getAll();

			expect(cookies.length).toBe(2);
		});
	});

	// ==========================================================================
	// get arguments tests (cookieStore_get_arguments.https.any.js)
	// ==========================================================================
	describe("cookieStore.get arguments", () => {
		test("cookieStore.get with no arguments throws TypeError", async () => {
			// @ts-expect-error - testing invalid usage
			await expect(cookieStore.get()).rejects.toThrow(TypeError);
		});

		test("cookieStore.get with empty options throws TypeError", async () => {
			// @ts-expect-error - testing invalid usage
			await expect(cookieStore.get({})).rejects.toThrow(TypeError);
		});

		test("cookieStore.get with positional name", async () => {
			await cookieStore.set("cookie-name", "cookie-value");
			const cookie = await cookieStore.get("cookie-name");
			expect(cookie?.name).toBe("cookie-name");
			expect(cookie?.value).toBe("cookie-value");
		});

		test("cookieStore.get with name in options", async () => {
			await cookieStore.set("cookie-name", "cookie-value");
			const cookie = await cookieStore.get({name: "cookie-name"});
			expect(cookie?.name).toBe("cookie-name");
			expect(cookie?.value).toBe("cookie-value");
		});

		test("cookieStore.get returns null for non-existent cookie", async () => {
			const cookie = await cookieStore.get("non-existent");
			expect(cookie).toBeNull();
		});
	});

	// ==========================================================================
	// set arguments tests (cookieStore_set_arguments.https.any.js)
	// ==========================================================================
	describe("cookieStore.set arguments", () => {
		test("cookieStore.set with positional name and value", async () => {
			await cookieStore.set("cookie-name", "cookie-value");
			const cookie = await cookieStore.get("cookie-name");
			expect(cookie?.name).toBe("cookie-name");
			expect(cookie?.value).toBe("cookie-value");
		});

		test("cookieStore.set with name and value in options", async () => {
			await cookieStore.set({name: "cookie-name", value: "cookie-value"});
			const cookie = await cookieStore.get("cookie-name");
			expect(cookie?.name).toBe("cookie-name");
			expect(cookie?.value).toBe("cookie-value");
		});

		test("cookieStore.set with value containing =", async () => {
			await cookieStore.set(
				"cookie-name",
				"suspicious-value=resembles-name-and-value",
			);
			const cookie = await cookieStore.get("cookie-name");
			expect(cookie?.name).toBe("cookie-name");
			expect(cookie?.value).toBe("suspicious-value=resembles-name-and-value");
		});

		test("cookieStore.set with expires set to a future Date", async () => {
			const tenYears = 10 * 365 * 24 * 60 * 60 * 1000;
			const tenYearsFromNow = Date.now() + tenYears;

			await cookieStore.set({
				name: "cookie-name",
				value: "cookie-value",
				expires: new Date(tenYearsFromNow),
			});
			const cookie = await cookieStore.get("cookie-name");
			expect(cookie?.name).toBe("cookie-name");
			expect(cookie?.value).toBe("cookie-value");
		});

		test("cookieStore.set with expires set to a future timestamp", async () => {
			const tenYears = 10 * 365 * 24 * 60 * 60 * 1000;
			const tenYearsFromNow = Date.now() + tenYears;

			await cookieStore.set({
				name: "cookie-name",
				value: "cookie-value",
				expires: tenYearsFromNow,
			});
			const cookie = await cookieStore.get("cookie-name");
			expect(cookie?.name).toBe("cookie-name");
			expect(cookie?.value).toBe("cookie-value");
		});

		test("cookieStore.set overwrites existing cookie", async () => {
			await cookieStore.set("cookie-name", "old-value");
			await cookieStore.set("cookie-name", "new-value");
			const cookie = await cookieStore.get("cookie-name");
			expect(cookie?.value).toBe("new-value");
		});
	});

	// ==========================================================================
	// RequestCookieStore-specific tests (reading from Request)
	// ==========================================================================
	describe("RequestCookieStore request parsing", () => {
		test("parses cookies from Request Cookie header", async () => {
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

		test("set overrides cookie from Request", async () => {
			const request = new Request("https://example.com", {
				headers: {
					Cookie: "session=old-value",
				},
			});
			const store = new RequestCookieStore(request);

			await store.set("session", "new-value");
			const cookie = await store.get("session");
			expect(cookie?.value).toBe("new-value");
		});

		test("delete removes cookie from Request", async () => {
			const request = new Request("https://example.com", {
				headers: {
					Cookie: "session=abc123",
				},
			});
			const store = new RequestCookieStore(request);

			await store.delete("session");
			const cookie = await store.get("session");
			expect(cookie).toBeNull();
		});

		test("getAll includes both Request cookies and set cookies", async () => {
			const request = new Request("https://example.com", {
				headers: {
					Cookie: "existing=from-request",
				},
			});
			const store = new RequestCookieStore(request);

			await store.set("new-cookie", "from-set");
			const cookies = await store.getAll();

			expect(cookies.length).toBe(2);
			const names = cookies.map((c) => c.name).sort();
			expect(names).toEqual(["existing", "new-cookie"]);
		});
	});

	// ==========================================================================
	// Set-Cookie header generation tests
	// ==========================================================================
	describe("Set-Cookie header generation", () => {
		test("getSetCookieHeaders returns headers for set cookies", async () => {
			await cookieStore.set("cookie-name", "cookie-value");
			const headers = cookieStore.getSetCookieHeaders();

			expect(headers.length).toBe(1);
			expect(headers[0]).toContain("cookie-name=cookie-value");
		});

		test("getSetCookieHeaders returns delete header for deleted cookies", async () => {
			await cookieStore.delete("cookie-name");
			const headers = cookieStore.getSetCookieHeaders();

			expect(headers.length).toBe(1);
			expect(headers[0]).toContain("cookie-name=");
			expect(headers[0]).toContain("Expires=");
		});

		test("hasChanges returns true after set", async () => {
			expect(cookieStore.hasChanges()).toBe(false);
			await cookieStore.set("cookie-name", "cookie-value");
			expect(cookieStore.hasChanges()).toBe(true);
		});

		test("hasChanges returns true after delete", async () => {
			expect(cookieStore.hasChanges()).toBe(false);
			await cookieStore.delete("cookie-name");
			expect(cookieStore.hasChanges()).toBe(true);
		});

		test("clearChanges removes pending changes", async () => {
			await cookieStore.set("cookie-name", "cookie-value");
			expect(cookieStore.hasChanges()).toBe(true);
			cookieStore.clearChanges();
			expect(cookieStore.hasChanges()).toBe(false);
		});
	});
});

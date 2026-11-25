import {test, expect, describe, beforeAll, beforeEach} from "bun:test";
import {z, table} from "@b9g/zen";
import {getLogger} from "@logtape/logtape";
import {Router} from "@b9g/router";
import type {
	AdminConfig,
	AdminRouter as AdminRouterType,
} from "../src/admin.jsx";

// ============================================================================
// Test Setup
// ============================================================================

const users = table("users", {
	id: z.number().db.primary(),
	name: z.string(),
});

const tags = table("tags", {
	slug: z.string().db.primary(),
	label: z.string(),
});

type Row = Record<string, unknown>;

/** In-memory stand-in for the zen Database methods the admin uses */
const tables = new Map<unknown, Map<unknown, Row>>([
	[users, new Map()],
	[tags, new Map()],
]);
let nextId = 100;

const fakeDb = {
	all: (t: unknown) => async () => [...tables.get(t)!.values()],
	get: async (t: unknown, id: unknown) => tables.get(t)!.get(id) ?? null,
	insert: async (t: unknown, data: Row) => {
		const row = {id: nextId++, ...data};
		tables.get(t)!.set(row.id, row);
		return row;
	},
	update: async (t: unknown, data: Row, id: unknown) => {
		const rows = tables.get(t)!;
		rows.set(id, {...rows.get(id), ...data});
	},
	delete: async (t: unknown, id: unknown) => {
		tables.get(t)!.delete(id);
	},
};

const origin = "http://localhost:7777";
let AdminRouter: typeof AdminRouterType;

beforeAll(async () => {
	// admin.tsx reads self.loggers at import time, so stub globals first
	Object.assign(globalThis, {
		loggers: {get: (categories: string[]) => getLogger(categories)},
		databases: {get: () => fakeDb},
	});
	({AdminRouter} = await import("../src/admin.jsx"));
});

beforeEach(() => {
	tables.get(users)!.clear();
	tables.get(users)!.set(1, {id: 1, name: "Alice"});
	tables.get(tags)!.clear();
	tables.get(tags)!.set("news", {slug: "news", label: "News"});
});

function mountAdmin(authorize: AdminConfig["authorize"]): Router {
	const admin = new AdminRouter({
		database: "main",
		schema: {users, tags},
		authorize,
	});
	const app = new Router();
	app.mount("/admin", admin);
	return app;
}

function get(path: string, headers: HeadersInit = {}): Request {
	return new Request(origin + path, {headers});
}

function post(
	path: string,
	body: Record<string, string> = {},
	headers: HeadersInit = {
		"Sec-Fetch-Site": "same-origin",
		Origin: origin,
	},
): Request {
	return new Request(origin + path, {
		method: "POST",
		headers,
		body: new URLSearchParams(body),
	});
}

const allowAll = () => true;
const denyAll = () => false;

// ============================================================================
// Authorization
// ============================================================================

describe("authorization", () => {
	test("constructor refuses to build without authorize", () => {
		expect(
			() =>
				new AdminRouter({
					database: "main",
					schema: {users},
				} as unknown as AdminConfig),
		).toThrow(/authorize/);
	});

	test("constructor rejects non-function authorize values", () => {
		expect(
			() =>
				new AdminRouter({
					database: "main",
					schema: {users},
					authorize: true,
				} as unknown as AdminConfig),
		).toThrow(/authorize/);
	});

	const getRoutes = [
		"/admin",
		"/admin/users",
		"/admin/users/new",
		"/admin/users/1",
		"/admin/users/1/edit",
		"/admin/users/1/delete",
		"/admin/does-not-exist",
	];

	for (const path of getRoutes) {
		test(`unauthenticated GET ${path} is denied`, async () => {
			const app = mountAdmin(denyAll);
			const res = await app.handle(get(path));
			expect(res.status).toBe(403);
			expect(await res.text()).not.toContain("Alice");
		});
	}

	test("unauthenticated POST create is denied", async () => {
		const app = mountAdmin(denyAll);
		const res = await app.handle(post("/admin/users/new", {name: "Mallory"}));
		expect(res.status).toBe(403);
		expect(tables.get(users)!.size).toBe(1);
	});

	test("unauthenticated POST edit is denied", async () => {
		const app = mountAdmin(denyAll);
		const res = await app.handle(
			post("/admin/users/1/edit", {name: "Mallory"}),
		);
		expect(res.status).toBe(403);
		expect(tables.get(users)!.get(1)!.name).toBe("Alice");
	});

	test("unauthenticated POST delete is denied", async () => {
		const app = mountAdmin(denyAll);
		const res = await app.handle(post("/admin/users/1/delete"));
		expect(res.status).toBe(403);
		expect(tables.get(users)!.has(1)).toBe(true);
	});

	test("non-boolean results fail closed", async () => {
		const app = mountAdmin((() => "yes") as unknown as () => boolean);
		const res = await app.handle(get("/admin/users/1"));
		expect(res.status).toBe(403);
	});

	test("a Response from authorize is returned as-is", async () => {
		const app = mountAdmin(() => Response.redirect(origin + "/login", 302));
		const res = await app.handle(get("/admin/users/1"));
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe(origin + "/login");
	});

	test("authorize receives the request and can allow it", async () => {
		const app = mountAdmin(
			async (req) => req.headers.get("Authorization") === "Bearer secret",
		);
		const denied = await app.handle(get("/admin/users/1"));
		expect(denied.status).toBe(403);

		const res = await app.handle(
			get("/admin/users/1", {Authorization: "Bearer secret"}),
		);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain("Alice");
	});

	test("unsafe-allow-all allows requests", async () => {
		const app = mountAdmin("unsafe-allow-all");
		const res = await app.handle(get("/admin/users/1"));
		expect(res.status).toBe(200);
	});

	test("unimplemented auth stub routes are gone", async () => {
		const app = mountAdmin(allowAll);
		for (const path of ["/admin/auth/login", "/admin/auth/logout"]) {
			const res = await app.handle(get(path));
			expect(res.status).toBe(404);
		}
	});
});

// ============================================================================
// CSRF
// ============================================================================

describe("CSRF protection", () => {
	const crossSiteHeaders: Array<[string, HeadersInit]> = [
		["Sec-Fetch-Site: cross-site", {"Sec-Fetch-Site": "cross-site"}],
		["Sec-Fetch-Site: same-site", {"Sec-Fetch-Site": "same-site"}],
		["Sec-Fetch-Site: none", {"Sec-Fetch-Site": "none"}],
		[
			"Sec-Fetch-Site: cross-site with matching Origin",
			{"Sec-Fetch-Site": "cross-site", Origin: origin},
		],
		["foreign Origin", {Origin: "https://evil.example"}],
		["null Origin", {Origin: "null"}],
		[
			"foreign Origin with same-origin Referer",
			{Origin: "https://evil.example", Referer: origin + "/admin"},
		],
		["foreign Referer", {Referer: "https://evil.example/admin"}],
		["malformed Referer", {Referer: "not a url"}],
		["no Origin or Referer", {}],
	];

	for (const [name, headers] of crossSiteHeaders) {
		test(`POST delete with ${name} is rejected`, async () => {
			const app = mountAdmin(allowAll);
			const res = await app.handle(post("/admin/users/1/delete", {}, headers));
			expect(res.status).toBe(403);
			expect(tables.get(users)!.has(1)).toBe(true);
		});
	}

	test("cross-site POST is rejected even with unsafe-allow-all", async () => {
		const app = mountAdmin("unsafe-allow-all");
		const res = await app.handle(
			post(
				"/admin/users/1/edit",
				{name: "Mallory"},
				{"Sec-Fetch-Site": "cross-site"},
			),
		);
		expect(res.status).toBe(403);
		expect(tables.get(users)!.get(1)!.name).toBe("Alice");
	});

	test("cross-site GET is still allowed", async () => {
		const app = mountAdmin(allowAll);
		const res = await app.handle(
			get("/admin/users", {"Sec-Fetch-Site": "cross-site"}),
		);
		expect(res.status).toBe(200);
	});

	test("same-origin POST via the delete form works", async () => {
		const app = mountAdmin(allowAll);
		const page = await app.handle(get("/admin/users/1/delete"));
		const action = (await page.text()).match(/action="([^"]+)"/)![1];
		expect(action).toBe("/admin/users/1/delete");

		const res = await app.handle(post(action));
		expect(res.status).toBe(303);
		expect(res.headers.get("Location")).toBe("/admin/users");
		expect(tables.get(users)!.has(1)).toBe(false);
	});

	test("same-origin POST edit works with Origin only", async () => {
		const app = mountAdmin(allowAll);
		const res = await app.handle(
			post("/admin/users/1/edit", {id: "1", name: "Bob"}, {Origin: origin}),
		);
		expect(res.status).toBe(303);
		expect(tables.get(users)!.get(1)!.name).toBe("Bob");
	});

	test("same-origin POST create works with Referer only", async () => {
		const app = mountAdmin(allowAll);
		const res = await app.handle(
			post(
				"/admin/users/new",
				{id: "2", name: "Carol"},
				{Referer: origin + "/admin/users/new"},
			),
		);
		expect(res.status).toBe(303);
		expect(
			[...tables.get(users)!.values()].some((r) => r.name === "Carol"),
		).toBe(true);
	});
});

// ============================================================================
// Malicious IDs
// ============================================================================

describe("route parameters never become a RegExp", () => {
	const maliciousIds = [
		"(1",
		"[",
		"*",
		"%5C",
		"(.*.*.*.*.*.*.*.*.*.*.*)[0-9]aaaaaaaa",
		"(a+)+$" + "a".repeat(30) + "!",
	];

	for (const id of maliciousIds) {
		for (const suffix of ["", "/edit", "/delete"]) {
			test(`GET /admin/users/${id}${suffix} is a fast 404`, async () => {
				const app = mountAdmin(allowAll);
				const start = performance.now();
				const res = await app.handle(get(`/admin/users/${id}${suffix}`));
				expect(performance.now() - start).toBeLessThan(250);
				expect(res.status).toBe(404);
			});
		}

		test(`POST /admin/users/${id}/delete is a fast 404`, async () => {
			const app = mountAdmin(allowAll);
			const start = performance.now();
			const res = await app.handle(post(`/admin/users/${id}/delete`));
			expect(performance.now() - start).toBeLessThan(250);
			expect(res.status).toBe(404);
		});

		test(`GET /admin/tags/${id} with a string key does not error`, async () => {
			const app = mountAdmin(allowAll);
			const start = performance.now();
			const res = await app.handle(get(`/admin/tags/${id}`));
			expect(performance.now() - start).toBeLessThan(250);
			expect(res.status).toBeLessThan(500);
			// Links on the page are still built from the real base path
			expect(await res.text()).toContain('href="/admin/tags"');
		});
	}
});

import {test, expect, describe} from "bun:test";
import {Router} from "../src/index.js";
import {trailingSlash} from "../src/middleware.js";

const auth = (request: Request) =>
	request.headers.get("x-auth") ? null : new Response("denied", {status: 401});

const secret = () => new Response("secret");

async function statusOf(router: Router, path: string): Promise<number> {
	const res = await router.handle(new Request("http://x.com" + path));
	return res.status;
}

describe("Middleware path prefixes", () => {
	test("a trailing slash on the prefix still covers paths under it", async () => {
		const router = new Router();
		router.use("/admin/", auth);
		router.route("/admin").get(secret);
		router.route("/admin/users").get(secret);
		router.route("/administrator").get(secret);

		expect(await statusOf(router, "/admin/users")).toBe(401);
		expect(await statusOf(router, "/admin")).toBe(401);
		expect(await statusOf(router, "/administrator")).toBe(200);
		expect(router.middlewares[0].pathPrefix).toBe("/admin");
	});

	test("a prefix without a leading slash is normalized", async () => {
		const router = new Router();
		router.use("admin", auth);
		router.route("/admin/users").get(secret);

		expect(await statusOf(router, "/admin/users")).toBe(401);
	});

	test('the prefix "/" applies to every path', async () => {
		const router = new Router();
		router.use("/", auth);
		router.route("/users").get(secret);

		expect(await statusOf(router, "/users")).toBe(401);
		expect(router.middlewares[0].pathPrefix).toBe(undefined);
	});

	test("a parameterized prefix covers the paths it matches", async () => {
		const router = new Router();
		router.use("/users/:id", auth);
		router.route("/users/:id").get(secret);
		router.route("/users/:id/posts").get(secret);
		router.route("/users").get(secret);

		expect(await statusOf(router, "/users/42")).toBe(401);
		expect(await statusOf(router, "/users/42/posts")).toBe(401);
		expect(await statusOf(router, "/users")).toBe(200);
	});

	test("a parameterized prefix still matches on segment boundaries", async () => {
		const router = new Router();
		router.use("/files/:id(\\d+)", auth);
		router.route("/files/:name").get(secret);
		router.route("/files/:name/raw").get(secret);

		expect(await statusOf(router, "/files/12")).toBe(401);
		expect(await statusOf(router, "/files/12/raw")).toBe(401);
		expect(await statusOf(router, "/files/12abc")).toBe(200);
	});

	test("a non-ASCII prefix matches the encoded request path", async () => {
		const router = new Router();
		router.use("/café", auth);
		router.route("/café/menu").get(secret);

		expect(await statusOf(router, "/café/menu")).toBe(401);
	});

	test("an invalid prefix pattern throws when registered", () => {
		const router = new Router();
		expect(() => router.use("/a/:id/:id", auth)).toThrow();
	});
});

describe("Mounting at a parameterized path", () => {
	test("subrouter middleware runs under a param mount path", async () => {
		const sub = new Router();
		sub.use(auth);
		sub.route("/x").get(secret);
		const router = new Router();
		router.mount("/:tenant", sub);

		expect(await statusOf(router, "/acme/x")).toBe(401);
	});

	test("subrouter prefixed middleware runs under a param mount path", async () => {
		const sub = new Router();
		sub.use("/admin", auth);
		sub.route("/admin/x").get(secret);
		sub.route("/public").get(secret);
		const router = new Router();
		router.mount("/:tenant", sub);

		expect(await statusOf(router, "/acme/admin/x")).toBe(401);
		expect(await statusOf(router, "/acme/public")).toBe(200);
	});

	test("trailingSlash() in a subrouter works under a param mount path", async () => {
		const sub = new Router();
		sub.use(trailingSlash("strip"));
		sub.route("/docs").get(secret);
		const router = new Router();
		router.mount("/:tenant", sub);

		const res = await router.handle(new Request("http://x.com/acme/docs/"));
		expect(res.status).toBe(301);
		expect(res.headers.get("Location")).toBe("http://x.com/acme/docs");
	});

	test("a scoped regexp redirect keeps its captures under a param prefix", async () => {
		const router = new Router();
		router.use("/:tenant", trailingSlash("strip"));
		router.route("/acme/docs").get(secret);

		const res = await router.handle(new Request("http://x.com/acme/docs/"));
		expect(res.status).toBe(301);
		expect(res.headers.get("Location")).toBe("http://x.com/acme/docs");
		// The serialized router behaves the same
		const client = Router.fromJSON(JSON.stringify(router));
		const res2 = await client.handle(new Request("http://x.com/acme/docs/"));
		expect(res2.headers.get("Location")).toBe("http://x.com/acme/docs");
	});
});

describe("Changing a router after mounting it", () => {
	test("adding middleware to a mounted router throws", () => {
		const sub = new Router();
		sub.route("/x").get(secret);
		const router = new Router();
		router.mount("/admin", sub);

		expect(() => sub.use(auth)).toThrow(/after it has been mounted/);
		expect(() => sub.use("/x", auth)).toThrow(/after it has been mounted/);
	});

	test("adding routes or redirects to a mounted router throws", () => {
		const sub = new Router();
		const builder = sub.route("/x");
		const router = new Router();
		router.mount("/admin", sub);

		expect(() => builder.get(secret)).toThrow(/after it has been mounted/);
		expect(() => sub.route("/y").get(secret)).toThrow(
			/after it has been mounted/,
		);
		expect(() => sub.redirect("/a", "/b")).toThrow(/after it has been mounted/);
		expect(() => sub.mount("/inner", new Router())).toThrow(
			/after it has been mounted/,
		);
	});

	test("a mounted router can still be mounted again", async () => {
		const sub = new Router();
		sub.use(auth);
		sub.route("/x").get(secret);
		const router = new Router();
		router.mount("/v1", sub);
		router.mount("/v2", sub);

		expect(await statusOf(router, "/v1/x")).toBe(401);
		expect(await statusOf(router, "/v2/x")).toBe(401);
	});
});

describe("Param names in the radix tree", () => {
	const params = (_request: Request, context: {params: unknown}) =>
		Response.json(context.params);

	test("sibling routes keep their own param names", async () => {
		const router = new Router();
		router.route("/orgs/:org/settings").get(params);
		router.route("/orgs/:user/profile").get(params);

		const settings = await router.handle(
			new Request("http://x.com/orgs/acme/settings"),
		);
		expect(await settings.json()).toEqual({org: "acme"});
		const profile = await router.handle(
			new Request("http://x.com/orgs/bob/profile"),
		);
		expect(await profile.json()).toEqual({user: "bob"});
	});

	test("match() names params for the matched route", () => {
		const router = new Router();
		router.route("/orgs/:org/settings").get(params);
		router.route("/orgs/:user/profile").get(params);

		expect(router.match("/orgs/bob/profile")).toEqual({
			params: {user: "bob"},
			methods: ["GET"],
			name: undefined,
			pattern: "/orgs/:user/profile",
		});
		expect(router.match("/orgs/acme/settings")?.params).toEqual({
			org: "acme",
		});
	});

	test("methods on the same path under different param names stay apart", async () => {
		const router = new Router();
		router.route("/items/:id").get(params);
		router.route("/items/:slug").post(params);

		const res = await router.handle(
			new Request("http://x.com/items/a", {method: "POST"}),
		);
		expect(await res.json()).toEqual({slug: "a"});
		expect(router.match("/items/a")).toEqual({
			params: {id: "a"},
			methods: ["GET"],
			name: undefined,
			pattern: "/items/:id",
		});
	});

	test("wildcards still capture alongside params", async () => {
		const router = new Router();
		router.route("/repos/:owner/*").get(params);

		const res = await router.handle(new Request("http://x.com/repos/me/a/b"));
		expect(await res.json()).toEqual({owner: "me", "0": "a/b"});
	});
});

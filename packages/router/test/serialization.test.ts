import {test, expect, describe} from "bun:test";
import {Router} from "../src/index.js";

/**
 * Build a representative router: static routes, params, multiple methods,
 * names, a wildcard, and a complex (regex-fallback) pattern.
 */
function makeRouter(): Router {
	const h = async () => new Response("ok");
	const router = new Router();
	router.route("/").get(h);
	router.route("/about", {name: "about"}).get(h);
	router.route("/api/users/:id", {name: "user"}).get(h).put(h).delete(h);
	router.route("/api/posts/:slug").get(h);
	router.route("/files/*").get(h);
	router.route("/mixed/:a/static/:b").get(h);
	return router;
}

const urls = [
	"http://x.com/",
	"http://x.com/about",
	"http://x.com/api/users/42",
	"http://x.com/api/posts/hello-world",
	"http://x.com/files/deep/nested/path.txt",
	"http://x.com/mixed/1/static/2",
	"http://x.com/nope",
];

describe("Router serialization", () => {
	test("toJSON emits format 1 and one entry per route/method in order", () => {
		const json = makeRouter().toJSON();
		expect(json.format).toBe(1);
		const userMethods = json.entries
			.filter(
				(e): e is {route: {pattern: string; method: string; name?: string}} =>
					"route" in e && e.route.pattern === "/api/users/:id",
			)
			.map((e) => e.route.method);
		expect(userMethods.sort()).toEqual(["DELETE", "GET", "PUT"]);
		expect(JSON.stringify(json)).not.toContain("function");
	});

	test("JSON.stringify(router) works via toJSON()", () => {
		const parsed = JSON.parse(JSON.stringify(makeRouter()));
		expect(parsed.format).toBe(1);
		expect(Array.isArray(parsed.entries)).toBe(true);
	});

	test("PARITY: fromJSON(toJSON(r)).match() equals r.match() for every URL", () => {
		const server = makeRouter();
		const client = Router.fromJSON(server.toJSON());
		for (const url of urls) {
			expect(client.match(url)).toEqual(server.match(url));
		}
	});

	test("PARITY holds across a JSON string round-trip", () => {
		const server = makeRouter();
		const client = Router.fromJSON(JSON.stringify(server));
		for (const url of urls) {
			expect(client.match(url)).toEqual(server.match(url));
		}
	});

	test("fromJSON yields a match-only router: handle() 404s", async () => {
		const client = Router.fromJSON(makeRouter().toJSON());
		expect(client.match("http://x.com/about")).not.toBeNull();
		const res = await client.handle(new Request("http://x.com/about"));
		expect(res.status).toBe(404);
	});

	test("fromJSON rejects an unsupported format", () => {
		expect(() => Router.fromJSON({format: 2 as 1, entries: []})).toThrow(
			/format/,
		);
	});

	test("routes with serialize: false are left out", async () => {
		const server = new Router();
		server.route("/").get(async () => new Response("home"));
		server
			.route("/debug/:id", {name: "debug", serialize: false})
			.get(async () => new Response("debug"))
			.post(async () => new Response("debug"));

		expect(server.toJSON().entries).toEqual([
			{route: {pattern: "/", method: "GET"}},
		]);
		expect(JSON.stringify(server)).not.toContain("debug");
		// The server still serves it
		const response = await server.handle(new Request("http://x.com/debug/1"));
		expect(response.status).toBe(200);
		expect(Router.fromJSON(server.toJSON()).match("/debug/1")).toBe(null);
	});

	test("a subrouter mounted with serialize: false is left out whole", async () => {
		const admin = new Router();
		admin.redirect("/old", "/users");
		admin
			.route("/users", {name: "admin-users"})
			.get(async () => new Response("users"));
		const app = new Router();
		app.route("/").get(async () => new Response("home"));
		app.mount("/admin", admin, {serialize: false});
		app.route("/about").get(async () => new Response("about"));

		expect(app.toJSON().entries).toEqual([
			{route: {pattern: "/", method: "GET"}},
			{route: {pattern: "/about", method: "GET"}},
		]);
		expect(JSON.stringify(app)).not.toContain("admin");
		expect(
			(await app.handle(new Request("http://x.com/admin/users"))).status,
		).toBe(200);
		expect(
			(await app.handle(new Request("http://x.com/admin/old"))).status,
		).toBe(301);
	});

	test("serialize: false survives mounting, at any depth", () => {
		const inner = new Router();
		inner.route("/open").get(async () => new Response("open"));
		inner
			.route("/secret", {serialize: false})
			.get(async () => new Response("secret"));
		const hidden = new Router();
		hidden.route("/x").get(async () => new Response("x"));
		inner.mount("/hidden", hidden, {serialize: false});
		const middle = new Router();
		middle.mount("/inner", inner);
		const app = new Router();
		app.mount("/api", middle);

		expect(app.toJSON().entries).toEqual([
			{route: {pattern: "/api/inner/open", method: "GET"}},
		]);
	});

	test("redirect and route precedence survives the round-trip", async () => {
		// A redirect wins over a route wherever each is declared, and a
		// fallback redirect loses to one; both must hold after fromJSON.
		const server = new Router();
		server.route("/old").get(async () => new Response("route"));
		server.redirect("/old", "/new");
		server.redirect("/keep", "/nope", {fallback: true});
		server.route("/keep").get(async () => new Response("route"));

		const client = Router.fromJSON(JSON.stringify(server));
		const old = await client.handle(new Request("http://x.com/old"));
		expect(old.status).toBe(301);
		expect(old.headers.get("Location")).toBe("http://x.com/new");
		// The route wins on the server; on the match-only client that is a 404,
		// not a redirect.
		const keep = await client.handle(new Request("http://x.com/keep"));
		expect(keep.status).toBe(404);
	});
});

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
	test("toJSON emits version 1 and one entry per route/method in order", () => {
		const json = makeRouter().toJSON();
		expect(json.version).toBe(1);
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
		expect(parsed.version).toBe(1);
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

	test("fromJSON rejects an unsupported version", () => {
		expect(() => Router.fromJSON({version: 2 as 1, entries: []})).toThrow(
			/version/,
		);
	});

	test("route↔redirect interleaving survives the round-trip", async () => {
		// A redirect declared BEFORE its route shadows it; this precedence must
		// hold identically after fromJSON.
		const server = new Router();
		server.redirect("/old", "/new"); // before → shadows
		server.route("/old").get(async () => new Response("route"));
		server.route("/keep").get(async () => new Response("route"));
		server.redirect("/keep", "/nope"); // after → route wins

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

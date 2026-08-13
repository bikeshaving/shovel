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
	test("toJSON emits version 1 and groups methods by pattern", () => {
		const json = makeRouter().toJSON();
		expect(json.version).toBe(1);
		const user = json.routes.find((r) => r.pattern === "/api/users/:id");
		expect(user).toBeDefined();
		expect(user!.methods.sort()).toEqual(["DELETE", "GET", "PUT"]);
		expect(user!.name).toBe("user");
		// No handlers or middleware leak into the serialized form.
		expect(JSON.stringify(json)).not.toContain("function");
	});

	test("JSON.stringify(router) works via toJSON()", () => {
		const str = JSON.stringify(makeRouter());
		const parsed = JSON.parse(str);
		expect(parsed.version).toBe(1);
		expect(Array.isArray(parsed.routes)).toBe(true);
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
		expect(() => Router.fromJSON({version: 2 as 1, routes: []})).toThrow(
			/version/,
		);
	});
});

import {test, expect, describe} from "bun:test";
import {Router} from "../src/index.js";
import {trailingSlash} from "../src/middleware.js";

const req = (url: string) => new Request(url);

describe("trailingSlash()", () => {
	test("strip: /about/ 301s to /about when no route matched", async () => {
		const router = new Router();
		router.route("/about").get(async () => new Response("about"));
		router.redirect(...trailingSlash("strip"));

		const ok = await router.handle(req("http://x.com/about"));
		expect(ok.status).toBe(200);

		const res = await router.handle(req("http://x.com/about/"));
		expect(res.status).toBe(301);
		expect(res.headers.get("Location")).toBe("http://x.com/about");
	});

	test("strip collapses multiple trailing slashes", async () => {
		const router = new Router();
		router.redirect(...trailingSlash("strip"));
		const res = await router.handle(req("http://x.com/a/b///"));
		expect(res.headers.get("Location")).toBe("http://x.com/a/b");
	});

	test("add and append: /about 301s to /about/", async () => {
		for (const mode of ["add", "append"] as const) {
			const router = new Router();
			router.redirect(...trailingSlash(mode));
			const res = await router.handle(req("http://x.com/about"));
			expect(res.status).toBe(301);
			expect(res.headers.get("Location")).toBe("http://x.com/about/");
		}
	});

	test("root '/' is never redirected", async () => {
		const strip = new Router();
		strip.redirect(...trailingSlash("strip"));
		expect((await strip.handle(req("http://x.com/"))).status).toBe(404);
		const add = new Router();
		add.redirect(...trailingSlash("add"));
		expect((await add.handle(req("http://x.com/"))).status).toBe(404);
	});

	test("preserves query strings", async () => {
		const router = new Router();
		router.redirect(...trailingSlash("strip"));
		const res = await router.handle(req("http://x.com/search/?q=test&page=1"));
		expect(res.headers.get("Location")).toBe(
			"http://x.com/search?q=test&page=1",
		);
	});

	test("a route declared before it wins on the non-canonical path", async () => {
		const router = new Router();
		router.route("/keep/").get(async () => new Response("kept"));
		router.redirect(...trailingSlash("strip"));
		const res = await router.handle(req("http://x.com/keep/"));
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("kept");
	});

	test("declared before a route, it shadows that route", async () => {
		const router = new Router();
		router.redirect(...trailingSlash("strip"));
		router.route("/keep/").get(async () => new Response("kept"));
		const res = await router.handle(req("http://x.com/keep/"));
		expect(res.status).toBe(301);
		expect(res.headers.get("Location")).toBe("http://x.com/keep");
	});

	test("a more specific redirect declared earlier wins", async () => {
		const router = new Router();
		router.redirect("/legacy/", "/brand-new");
		router.redirect(...trailingSlash("strip"));
		const res = await router.handle(req("http://x.com/legacy/"));
		expect(res.headers.get("Location")).toBe("http://x.com/brand-new");
	});

	test("serializes as an ordinary redirect entry", async () => {
		const server = new Router();
		server.redirect(...trailingSlash("strip"));
		expect(server.toJSON().entries).toEqual([
			{
				redirect: {
					match: {source: "^(.+?)\\/+$", flags: ""},
					target: "$1",
					status: 301,
				},
			},
		]);

		const client = Router.fromJSON(JSON.stringify(server));
		const res = await client.handle(req("http://x.com/a/"));
		expect(res.status).toBe(301);
		expect(res.headers.get("Location")).toBe("http://x.com/a");
	});
});

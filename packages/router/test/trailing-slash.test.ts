import {test, expect, describe} from "bun:test";
import {Router} from "../src/index.js";

const req = (url: string) => new Request(url);

/**
 * trailingSlash() is pure sugar over redirect() — a fallthrough redirect, not
 * a special facet. So it serializes as an ordinary redirect entry and obeys the
 * same first-match-wins ordering as every other redirect.
 */
describe("Trailing-slash (sugar over redirect)", () => {
	test("strip: /about/ 301s to /about after a 404", async () => {
		const router = new Router();
		router.route("/about").get(async () => new Response("about"));
		router.trailingSlash("strip");

		const ok = await router.handle(req("http://x.com/about"));
		expect(ok.status).toBe(200);

		const res = await router.handle(req("http://x.com/about/"));
		expect(res.status).toBe(301);
		expect(res.headers.get("Location")).toBe("http://x.com/about");
	});

	test("strip collapses multiple trailing slashes", async () => {
		const router = new Router();
		router.trailingSlash("strip");
		const res = await router.handle(req("http://x.com/a/b///"));
		expect(res.headers.get("Location")).toBe("http://x.com/a/b");
	});

	test("append: /about 301s to /about/", async () => {
		const router = new Router();
		router.trailingSlash("append");
		const res = await router.handle(req("http://x.com/about"));
		expect(res.status).toBe(301);
		expect(res.headers.get("Location")).toBe("http://x.com/about/");
	});

	test("root '/' is never redirected", () => {
		const strip = new Router();
		strip.trailingSlash("strip");
		expect(strip.resolveRedirect("http://x.com/", "fallthrough")).toBeNull();
		const append = new Router();
		append.trailingSlash("append");
		expect(append.resolveRedirect("http://x.com/", "fallthrough")).toBeNull();
	});

	test("an explicit route on the non-canonical path wins (fallthrough)", async () => {
		const router = new Router();
		router.route("/keep/").get(async () => new Response("kept"));
		router.trailingSlash("strip");
		const res = await router.handle(req("http://x.com/keep/"));
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("kept");
	});

	test("precedence is just declaration order — declare specific redirects first", () => {
		const router = new Router();
		// Specific redirect declared BEFORE the catch-all sugar → it wins.
		router.redirect("/legacy/", "/brand-new", {phase: "fallthrough"});
		router.trailingSlash("strip");
		expect(
			router.resolveRedirect("http://x.com/legacy/", "fallthrough")?.location,
		).toBe("http://x.com/brand-new");
	});

	test("serializes as an ordinary redirect (no special envelope field)", () => {
		const server = new Router();
		server.trailingSlash("strip");
		const json = server.toJSON();
		// No `trailingSlash` facet on the envelope — it's a normal redirect.
		expect("trailingSlash" in json).toBe(false);
		expect(json.redirects).toHaveLength(1);
		expect(json.redirects[0].phase).toBe("fallthrough");

		// Round-trips like any other redirect.
		const client = Router.fromJSON(JSON.stringify(server));
		expect(client.resolveRedirect("http://x.com/a/", "fallthrough")).toEqual(
			server.resolveRedirect("http://x.com/a/", "fallthrough"),
		);
	});

	test("no trailingSlash() call → no redirect", () => {
		const router = new Router();
		expect(router.redirects).toHaveLength(0);
		expect(router.resolveRedirect("http://x.com/a/", "fallthrough")).toBeNull();
	});
});

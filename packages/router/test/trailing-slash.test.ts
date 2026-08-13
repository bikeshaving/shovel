import {test, expect, describe} from "bun:test";
import {Router} from "../src/index.js";

const req = (url: string) => new Request(url);

/**
 * trailingSlash() is pure sugar over redirect() — an ordinary redirect whose
 * precedence is just where you call it. Call it after your routes (the usual
 * spot) and it only fires when nothing matched.
 */
describe("Trailing-slash (sugar over redirect)", () => {
	test("strip: /about/ 301s to /about when no route matched", async () => {
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
		expect(strip.resolveRedirect("http://x.com/")).toBeNull();
		const append = new Router();
		append.trailingSlash("append");
		expect(append.resolveRedirect("http://x.com/")).toBeNull();
	});

	test("an explicit route on the non-canonical path wins", async () => {
		const router = new Router();
		router.route("/keep/").get(async () => new Response("kept")); // first
		router.trailingSlash("strip"); // after → route wins on /keep/
		const res = await router.handle(req("http://x.com/keep/"));
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("kept");
	});

	test("precedence is declaration order — specific redirect before the catch-all", () => {
		const router = new Router();
		router.redirect("/legacy/", "/brand-new"); // first → wins over strip
		router.trailingSlash("strip");
		expect(router.resolveRedirect("http://x.com/legacy/")?.location).toBe(
			"http://x.com/brand-new",
		);
	});

	test("serializes as an ordinary redirect (no special envelope field)", () => {
		const server = new Router();
		server.trailingSlash("strip");
		const json = server.toJSON();
		expect("trailingSlash" in json).toBe(false);
		expect(json.redirects).toHaveLength(1);
		expect("phase" in json.redirects[0]).toBe(false);

		const client = Router.fromJSON(JSON.stringify(server));
		expect(client.resolveRedirect("http://x.com/a/")).toEqual(
			server.resolveRedirect("http://x.com/a/"),
		);
	});

	test("no trailingSlash() call → no redirect", () => {
		const router = new Router();
		expect(router.redirects).toHaveLength(0);
		expect(router.resolveRedirect("http://x.com/a/")).toBeNull();
	});
});

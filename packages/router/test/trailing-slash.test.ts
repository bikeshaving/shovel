import {test, expect, describe} from "bun:test";
import {Router} from "../src/index.js";

const req = (url: string) => new Request(url);

describe("Trailing-slash policy (data facet)", () => {
	test("strip: /about/ 301s to /about after a 404", async () => {
		const router = new Router();
		router.trailingSlash("strip");
		router.route("/about").get(async () => new Response("about"));

		// Canonical path serves normally.
		const ok = await router.handle(req("http://x.com/about"));
		expect(ok.status).toBe(200);

		// Non-canonical path falls through to a 301.
		const res = await router.handle(req("http://x.com/about/"));
		expect(res.status).toBe(301);
		expect(res.headers.get("Location")).toBe("http://x.com/about");
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

	test("an explicit route on the non-canonical path wins over the policy", async () => {
		const router = new Router();
		router.trailingSlash("strip");
		router.route("/keep/").get(async () => new Response("kept"));
		const res = await router.handle(req("http://x.com/keep/"));
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("kept");
	});

	test("explicit fallthrough redirects win over the trailing-slash policy", () => {
		const router = new Router();
		router.trailingSlash("strip");
		router.redirect("/legacy/", "/brand-new", {phase: "fallthrough"});
		const r = router.resolveRedirect("http://x.com/legacy/", "fallthrough");
		expect(r?.location).toBe("http://x.com/brand-new");
	});

	test("policy travels through serialization", () => {
		const server = new Router();
		server.trailingSlash("strip");
		const json = server.toJSON();
		expect(json.trailingSlash).toBe("strip");

		const client = Router.fromJSON(JSON.stringify(server));
		expect(client.trailingSlashPolicy).toBe("strip");
		expect(client.resolveRedirect("http://x.com/a/", "fallthrough")).toEqual(
			server.resolveRedirect("http://x.com/a/", "fallthrough"),
		);
	});

	test("no policy set → nothing in toJSON, no redirect", () => {
		const router = new Router();
		expect(router.toJSON().trailingSlash).toBeUndefined();
		expect(router.resolveRedirect("http://x.com/a/", "fallthrough")).toBeNull();
	});
});

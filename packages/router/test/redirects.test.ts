import {test, expect, describe} from "bun:test";
import {Router} from "../src/index.js";

const req = (url: string) => new Request(url);

describe("Redirects as data", () => {
	test("eager redirect fires before matching, with :param substitution", async () => {
		const router = new Router();
		router.redirect("/old/:id", "/new/:id");
		router.route("/old/:id").get(async () => new Response("should not run"));

		const res = await router.handle(req("http://x.com/old/42"));
		expect(res.status).toBe(301);
		expect(res.headers.get("Location")).toBe("http://x.com/new/42");
	});

	test("fallthrough redirect only fires after a 404", async () => {
		const router = new Router();
		router.redirect("/legacy", "/current", {phase: "fallthrough"});
		router.route("/legacy").get(async () => new Response("live"));

		// /legacy has a live route → no redirect (fallthrough didn't fire).
		const live = await router.handle(req("http://x.com/legacy"));
		expect(live.status).toBe(200);
		expect(await live.text()).toBe("live");

		// /gone has no route → 404 → fallthrough applies.
		const gone = new Router();
		gone.redirect("/gone", "/home", {phase: "fallthrough"});
		const res = await gone.handle(req("http://x.com/gone"));
		expect(res.status).toBe(301);
		expect(res.headers.get("Location")).toBe("http://x.com/home");
	});

	test("regexp flavor rewrites with $1", async () => {
		const router = new Router();
		router.redirect(/^\/blog\/(\d+)\/(.+)$/, "/posts/$2", {status: 302});
		const res = await router.handle(req("http://x.com/blog/2024/hello"));
		expect(res.status).toBe(302);
		expect(res.headers.get("Location")).toBe("http://x.com/posts/hello");
	});

	test("scope gates a redirect to a path prefix", () => {
		const router = new Router();
		router.redirect("/:rest*", "/blocked", {scope: "/admin"});
		expect(
			router.resolveRedirect("http://x.com/admin/x", "eager"),
		).not.toBeNull();
		expect(router.resolveRedirect("http://x.com/public/x", "eager")).toBeNull();
	});

	test("first matching redirect wins (declaration order)", () => {
		const router = new Router();
		router.redirect("/a", "/first");
		router.redirect("/a", "/second");
		const r = router.resolveRedirect("http://x.com/a", "eager");
		expect(r?.location).toBe("http://x.com/first");
	});

	test("PARITY: fromJSON reapplies redirects identically", () => {
		const server = new Router();
		server.redirect("/old/:id", "/new/:id");
		server.redirect(/^\/x\/(.+)$/, "/y/$1", {status: 302});
		server.redirect("/tmp", "/home", {phase: "fallthrough", scope: "/tmp"});

		const client = Router.fromJSON(JSON.stringify(server));
		for (const url of [
			"http://x.com/old/7",
			"http://x.com/x/deep/path",
			"http://x.com/tmp",
			"http://x.com/none",
		]) {
			for (const phase of ["eager", "fallthrough"] as const) {
				expect(client.resolveRedirect(url, phase)).toEqual(
					server.resolveRedirect(url, phase),
				);
			}
		}
	});

	test("redirects serialize as plain data (no functions)", () => {
		const router = new Router();
		router.redirect("/a", "/b");
		const json = router.toJSON();
		expect(json.redirects).toEqual([
			{match: {pattern: "/a"}, target: "/b", phase: "eager", status: 301},
		]);
	});
});

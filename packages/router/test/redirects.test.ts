import {test, expect, describe} from "bun:test";
import {Router} from "../src/index.js";

const req = (url: string) => new Request(url);

describe("Redirects as data", () => {
	test("a redirect declared BEFORE a route shadows it (:param substitution)", async () => {
		const router = new Router();
		router.redirect("/old/:id", "/new/:id"); // declared first → wins
		router.route("/old/:id").get(async () => new Response("should not run"));

		const res = await router.handle(req("http://x.com/old/42"));
		expect(res.status).toBe(301);
		expect(res.headers.get("Location")).toBe("http://x.com/new/42");
	});

	test("a redirect declared AFTER a route only fires when nothing matched", async () => {
		const router = new Router();
		router.route("/legacy").get(async () => new Response("live")); // first
		router.redirect("/legacy", "/current"); // after → route wins on /legacy

		const live = await router.handle(req("http://x.com/legacy"));
		expect(live.status).toBe(200);
		expect(await live.text()).toBe("live");

		// A path with no route → the redirect applies.
		const gone = new Router();
		gone.redirect("/gone", "/home");
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

	test("limiting a redirect to a prefix is done in the matcher, not a facet", () => {
		const router = new Router();
		router.redirect("/admin/:rest*", "/blocked");
		expect(router.resolveRedirect("http://x.com/admin/x")).not.toBeNull();
		expect(router.resolveRedirect("http://x.com/public/x")).toBeNull();
	});

	test("first matching redirect wins (declaration order)", () => {
		const router = new Router();
		router.redirect("/a", "/first");
		router.redirect("/a", "/second");
		expect(router.resolveRedirect("http://x.com/a")?.location).toBe(
			"http://x.com/first",
		);
	});

	test("PARITY: fromJSON reapplies redirects identically", () => {
		const server = new Router();
		server.redirect("/old/:id", "/new/:id");
		server.redirect(/^\/x\/(.+)$/, "/y/$1", {status: 302});
		server.redirect("/tmp", "/home");

		const client = Router.fromJSON(JSON.stringify(server));
		for (const url of [
			"http://x.com/old/7",
			"http://x.com/x/deep/path",
			"http://x.com/tmp",
			"http://x.com/none",
		]) {
			expect(client.resolveRedirect(url)).toEqual(server.resolveRedirect(url));
		}
	});

	test("redirects serialize as plain data", () => {
		const router = new Router();
		router.redirect("/a", "/b");
		expect(router.toJSON().entries).toEqual([
			{redirect: {match: {pattern: "/a"}, target: "/b", status: 301}},
		]);
	});
});

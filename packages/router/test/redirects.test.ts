import {test, expect, describe} from "bun:test";
import {Router} from "../src/index.js";

const req = (url: string) => new Request(url);

async function redirectOf(
	router: Router,
	url: string,
): Promise<{location: string | null; status: number} | null> {
	const res = await router.handle(req(url));
	if (res.status < 300 || res.status > 399) return null;
	return {location: res.headers.get("Location"), status: res.status};
}

describe("Redirects as data", () => {
	test("a redirect declared BEFORE a route shadows it (:param substitution)", async () => {
		const router = new Router();
		router.redirect("/old/:id", "/new/:id");
		router.route("/old/:id").get(async () => new Response("should not run"));

		const res = await router.handle(req("http://x.com/old/42"));
		expect(res.status).toBe(301);
		expect(res.headers.get("Location")).toBe("http://x.com/new/42");
	});

	test("a redirect declared AFTER a route only fires when nothing matched", async () => {
		const router = new Router();
		router.route("/legacy").get(async () => new Response("live"));
		router.redirect("/legacy", "/current");

		const live = await router.handle(req("http://x.com/legacy"));
		expect(live.status).toBe(200);
		expect(await live.text()).toBe("live");

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

	test("limiting a redirect to a prefix is done in the matcher", async () => {
		const router = new Router();
		router.redirect("/admin/:rest*", "/blocked");
		expect(await redirectOf(router, "http://x.com/admin/x")).not.toBeNull();
		expect(await redirectOf(router, "http://x.com/public/x")).toBeNull();
	});

	test("first matching redirect wins (declaration order)", async () => {
		const router = new Router();
		router.redirect("/a", "/first");
		router.redirect("/a", "/second");
		expect((await redirectOf(router, "http://x.com/a"))?.location).toBe(
			"http://x.com/first",
		);
	});

	test("PARITY: fromJSON reapplies redirects identically", async () => {
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
			expect(await redirectOf(client, url)).toEqual(
				await redirectOf(server, url),
			);
		}
	});

	test("the request query carries over unless the target sets its own", async () => {
		const router = new Router();
		router.redirect("/a", "/b");
		router.redirect("/c", "/d?fixed=1");
		expect((await redirectOf(router, "http://x.com/a?q=1"))?.location).toBe(
			"http://x.com/b?q=1",
		);
		expect((await redirectOf(router, "http://x.com/c?q=1"))?.location).toBe(
			"http://x.com/d?fixed=1",
		);
	});

	test("redirects serialize as plain data", () => {
		const router = new Router();
		router.redirect("/a", "/b");
		expect(router.toJSON().entries).toEqual([
			{redirect: {match: {pattern: "/a"}, target: "/b", status: 301}},
		]);
	});
});

describe("Redirects in mounted subrouters", () => {
	test("a pattern redirect moves under the mount path", async () => {
		const sub = new Router();
		sub.redirect("/old/:id", "/new/:id");
		const router = new Router();
		router.mount("/api", sub);

		expect(await redirectOf(router, "http://x.com/api/old/42")).toEqual({
			location: "http://x.com/api/new/42",
			status: 301,
		});
		expect(await redirectOf(router, "http://x.com/old/42")).toBe(null);
	});

	test("a regex redirect keeps its capture groups under the mount path", async () => {
		const sub = new Router();
		sub.redirect(/^\/docs\/(.+)$/, "/guides/$1", {status: 308});
		const router = new Router();
		router.mount("/api", sub);

		expect(await redirectOf(router, "http://x.com/api/docs/a/b")).toEqual({
			location: "http://x.com/api/guides/a/b",
			status: 308,
		});
		expect(await redirectOf(router, "http://x.com/apidocs/a")).toBe(null);
		expect(await redirectOf(router, "http://x.com/docs/a")).toBe(null);
	});

	test("a target made only of a capture stays under the mount path", async () => {
		const sub = new Router();
		sub.redirect(/^(.+)\/$/, "$1");
		const router = new Router();
		router.mount("/api", sub);

		expect(await redirectOf(router, "http://x.com/api/users/")).toEqual({
			location: "http://x.com/api/users",
			status: 301,
		});
	});

	test("an absolute URL target is left alone", async () => {
		const sub = new Router();
		sub.redirect("/away", "https://example.com/elsewhere");
		const router = new Router();
		router.mount("/api", sub);

		expect(await redirectOf(router, "http://x.com/api/away")).toEqual({
			location: "https://example.com/elsewhere",
			status: 301,
		});
	});

	test("routes and redirects keep the subrouter's order", async () => {
		const sub = new Router();
		sub.route("/a").get(async () => new Response("a"));
		sub.redirect("/a", "/b");
		sub.redirect("/c", "/d");
		sub.route("/c").get(async () => new Response("c"));
		const router = new Router();
		router.mount("/api", sub);

		const a = await router.handle(req("http://x.com/api/a"));
		expect(a.status).toBe(200);
		expect(await redirectOf(router, "http://x.com/api/c")).toEqual({
			location: "http://x.com/api/d",
			status: 301,
		});
	});

	test("mounted redirects serialize and replay on the client", async () => {
		const sub = new Router();
		sub.redirect("/old/:id", "/new/:id");
		sub.route("/new/:id").get(async () => new Response("new"));
		const router = new Router();
		router.mount("/api", sub);

		expect(router.toJSON().entries).toEqual([
			{
				redirect: {
					match: {pattern: "/api/old/:id"},
					target: "/api/new/:id",
					status: 301,
				},
			},
			{route: {pattern: "/api/new/:id", method: "GET"}},
		]);
		const client = Router.fromJSON(JSON.stringify(router));
		expect(await redirectOf(client, "http://x.com/api/old/7")).toEqual({
			location: "http://x.com/api/new/7",
			status: 301,
		});
	});

	test("mounting at the root leaves redirects unchanged", async () => {
		const sub = new Router();
		sub.redirect("/old", "/new");
		const router = new Router();
		router.mount("/", sub);

		expect(await redirectOf(router, "http://x.com/old")).toEqual({
			location: "http://x.com/new",
			status: 301,
		});
	});

	test("an unanchored regex redirect cannot be mounted", () => {
		const sub = new Router();
		sub.redirect(/old/, "/new");
		const router = new Router();
		expect(() => router.mount("/api", sub)).toThrow(/anchored/);
	});
});

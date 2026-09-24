import {test, expect, describe} from "bun:test";
import {Router} from "../src/index.js";
import {trailingSlash} from "../src/middleware.js";

async function redirectOf(router: Router, url: string): Promise<string | null> {
	const res = await router.handle(new Request(url));
	return res.status === 301 ? res.headers.get("Location") : null;
}

describe("trailingSlash() serialization", () => {
	test("serializes as a redirect entry after the routes", () => {
		const router = new Router();
		router.use(trailingSlash("strip"));
		router.route("/about").get(async () => new Response("about"));

		expect(router.toJSON().entries).toEqual([
			{route: {pattern: "/about", method: "GET"}},
			{
				redirect: {
					match: {source: "^(.+)/$", flags: ""},
					target: "$1",
					status: 301,
				},
			},
		]);
	});

	for (const mode of ["strip", "add"] as const) {
		test(`client redirects exactly where the server does (${mode})`, async () => {
			const server = new Router();
			server.use(trailingSlash(mode));
			server.route("/about").get(async () => new Response("about"));
			server.route("/docs/").get(async () => new Response("docs"));
			const client = Router.fromJSON(JSON.stringify(server));

			const urls = [
				"/",
				"/about",
				"/about/",
				"/docs",
				"/docs/",
				"/missing",
				"/missing/",
				"/a//",
				"/q/?x=1",
				"/q?x=1",
			];
			for (const path of urls) {
				const url = `http://x.com${path}`;
				expect([path, await redirectOf(client, url)]).toEqual([
					path,
					await redirectOf(server, url),
				]);
			}
		});
	}

	test("a path-scoped trailingSlash() stays scoped on the client", async () => {
		const server = new Router();
		server.use("/api", trailingSlash("strip"));
		const client = Router.fromJSON(server.toJSON());

		for (const path of ["/api/", "/api/users/", "/apiary/", "/other/"]) {
			const url = `http://x.com${path}`;
			expect([path, await redirectOf(client, url)]).toEqual([
				path,
				await redirectOf(server, url),
			]);
		}
		expect(await redirectOf(client, "http://x.com/api/users/")).toBe(
			"http://x.com/api/users",
		);
		expect(await redirectOf(client, "http://x.com/other/")).toBe(null);
	});

	test("a mounted subrouter's trailingSlash() is scoped to the mount path", async () => {
		const sub = new Router();
		sub.use(trailingSlash("strip"));
		sub.route("/users").get(async () => new Response("users"));
		const server = new Router();
		server.mount("/api", sub);
		const client = Router.fromJSON(server.toJSON());

		expect(await redirectOf(client, "http://x.com/api/users/")).toBe(
			"http://x.com/api/users",
		);
		expect(await redirectOf(client, "http://x.com/other/")).toBe(null);
	});

	test("other middleware is not serialized", () => {
		const router = new Router();
		router.use(async () => null);
		router.route("/").get(async () => new Response("home"));
		expect(router.toJSON().entries).toEqual([
			{route: {pattern: "/", method: "GET"}},
		]);
	});
});

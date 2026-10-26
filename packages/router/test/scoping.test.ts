import {test, expect, describe} from "bun:test";
import {Router} from "../src/index.js";

describe("Param names in the radix tree", () => {
	const params = (_request: Request, context: {params: unknown}) =>
		Response.json(context.params);

	test("sibling routes keep their own param names", async () => {
		const router = new Router();
		router.route("/orgs/:org/settings").get(params);
		router.route("/orgs/:user/profile").get(params);

		const settings = await router.handle(
			new Request("http://x.com/orgs/acme/settings"),
		);
		expect(await settings.json()).toEqual({org: "acme"});
		const profile = await router.handle(
			new Request("http://x.com/orgs/bob/profile"),
		);
		expect(await profile.json()).toEqual({user: "bob"});
	});

	test("match() names params for the matched route", () => {
		const router = new Router();
		router.route("/orgs/:org/settings").get(params);
		router.route("/orgs/:user/profile").get(params);

		expect(router.match("/orgs/bob/profile")).toEqual({
			params: {user: "bob"},
			methods: ["GET"],
			name: undefined,
			pattern: "/orgs/:user/profile",
		});
		expect(router.match("/orgs/acme/settings")?.params).toEqual({
			org: "acme",
		});
	});

	test("methods on the same path under different param names stay apart", async () => {
		const router = new Router();
		router.route("/items/:id").get(params);
		router.route("/items/:slug").post(params);

		const res = await router.handle(
			new Request("http://x.com/items/a", {method: "POST"}),
		);
		expect(await res.json()).toEqual({slug: "a"});
		expect(router.match("/items/a")).toEqual({
			params: {id: "a"},
			methods: ["GET"],
			name: undefined,
			pattern: "/items/:id",
		});
	});

	test("wildcards still capture alongside params", async () => {
		const router = new Router();
		router.route("/repos/:owner/*").get(params);

		const res = await router.handle(new Request("http://x.com/repos/me/a/b"));
		expect(await res.json()).toEqual({owner: "me", "0": "a/b"});
	});
});

import {test, expect, describe} from "bun:test";
import {Router} from "../src/index.js";
import {trailingSlash} from "../src/middleware.js";
import {
	listen,
	type ClientNavigation,
	type NavigateEventLike,
	type NavigationLike,
} from "../src/client.js";

const origin = "http://x.com";

function makeServer(): Router {
	const h = async () => new Response("ok");
	const server = new Router();
	server.use(trailingSlash("strip"));
	server.redirect("/old/:id", "/posts/:id");
	server.redirect("/away", "https://other.example/");
	server.redirect("/a", "/b");
	server.redirect("/b", "/a");
	server.route("/", {name: "home"}).get(h);
	server.route("/posts/:id", {name: "post"}).get(h).post(h);
	server.route("/docs/").get(h);
	server.route("/secret", {serialize: false}).get(h);
	return server;
}

/**
 * A stand-in for window.navigation: records what the listener did with each
 * event, and feeds navigate() calls back in as new navigations.
 */
class FakeNavigation implements NavigationLike {
	listeners: Set<(event: NavigateEventLike) => void>;
	/** One line per navigation, in order */
	log: string[];
	pending: Promise<void>[];

	constructor() {
		this.listeners = new Set();
		this.log = [];
		this.pending = [];
	}

	addEventListener(
		_type: "navigate",
		listener: (e: NavigateEventLike) => void,
	) {
		this.listeners.add(listener);
	}

	removeEventListener(
		_type: "navigate",
		listener: (e: NavigateEventLike) => void,
	) {
		this.listeners.delete(listener);
	}

	navigate(url: string, options: {history?: string} = {}) {
		this.dispatch(url, {
			navigationType: options.history === "replace" ? "replace" : "push",
		});
	}

	dispatch(
		url: string,
		init: Partial<
			Pick<
				NavigateEventLike,
				| "canIntercept"
				| "cancelable"
				| "hashChange"
				| "downloadRequest"
				| "formData"
				| "navigationType"
			>
		> = {},
	) {
		const href = new URL(url, origin).href;
		let outcome = "browser";
		const event: NavigateEventLike = {
			canIntercept: new URL(href).origin === origin,
			cancelable: true,
			hashChange: false,
			downloadRequest: null,
			formData: null,
			navigationType: "push",
			...init,
			destination: {url: href},
			signal: new AbortController().signal,
			preventDefault: () => {
				outcome = "cancelled";
			},
			intercept: (options) => {
				outcome = "intercepted";
				if (options?.handler) this.pending.push(options.handler());
			},
		};
		// Reserve this navigation's place before any redirect it starts
		const index = this.log.push("") - 1;
		for (const listener of this.listeners) listener(event);
		const shown = href.startsWith(origin + "/")
			? href.slice(origin.length)
			: href;
		this.log[index] = `${event.navigationType} ${shown} ${outcome}`;
	}
}

function setup(server = makeServer()) {
	const navigation = new FakeNavigation();
	const handled: ClientNavigation[] = [];
	const stop = listen(
		Router.fromJSON(JSON.stringify(server)),
		(nav) => {
			handled.push(nav);
		},
		{navigation},
	);
	return {navigation, handled, stop};
}

describe("router.resolve()", () => {
	test("agrees with handle() on a router from fromJSON()", async () => {
		const client = Router.fromJSON(JSON.stringify(makeServer()));
		const paths = [
			"/",
			"/posts/1",
			"/posts/1/",
			"/old/7",
			"/old/7?x=1",
			"/docs",
			"/docs/",
			"/missing",
			"/missing/",
			"/away",
			"/a",
			"/b",
			"/secret",
		];
		for (const path of paths) {
			for (const method of ["GET", "POST"]) {
				const response = await client.handle(
					new Request(origin + path, {method}),
				);
				const expected =
					response.status === 301 ? response.headers.get("Location") : null;
				const resolution = client.resolve(origin + path, method);
				expect([path, method, resolution?.redirect?.location ?? null]).toEqual([
					path,
					method,
					expected,
				]);
			}
		}
	});

	test("reports the matching route, its params and its name", () => {
		const client = Router.fromJSON(JSON.stringify(makeServer()));
		expect(client.resolve(origin + "/posts/42")).toEqual({
			route: {
				params: {id: "42"},
				methods: ["GET", "POST"],
				name: "post",
				pattern: "/posts/:id",
			},
		});
		expect(client.resolve(origin + "/posts/42", "DELETE")).toBe(null);
		expect(client.resolve(origin + "/missing")).toBe(null);
		// Left out of the serialized router, so the server must answer
		expect(client.resolve(origin + "/secret")).toBe(null);
	});

	test("a redirect comes before a route, a fallback redirect after", () => {
		const router = new Router();
		router.route("/x").get(async () => new Response("x"));
		router.redirect("/x", "/y");
		router.route("/kept").get(async () => new Response("kept"));
		router.redirect("/kept", "/gone", {fallback: true});
		expect(router.resolve(origin + "/x")).toEqual({
			redirect: {location: origin + "/y", status: 301},
		});
		expect(router.resolve(origin + "/kept")?.route?.pattern).toBe("/kept");
	});
});

describe("listen()", () => {
	test("hands a matched navigation to the handler", async () => {
		const {navigation, handled} = setup();
		navigation.dispatch("/posts/42?draft=1");
		await Promise.all(navigation.pending);

		expect(navigation.log).toEqual(["push /posts/42?draft=1 intercepted"]);
		expect(handled).toHaveLength(1);
		expect(handled[0].url.href).toBe(origin + "/posts/42?draft=1");
		expect(handled[0].route.name).toBe("post");
		expect(handled[0].route.params).toEqual({id: "42"});
		expect(handled[0].method).toBe("GET");
	});

	test("leaves what the router has no answer for to the browser", () => {
		const {navigation, handled} = setup();
		navigation.dispatch("/missing");
		navigation.dispatch("/secret");
		navigation.dispatch("https://other.example/posts/1");
		navigation.dispatch("/posts/1", {hashChange: true});
		navigation.dispatch("/posts/1", {downloadRequest: "post.html"});

		expect(navigation.log).toEqual([
			"push /missing browser",
			"push /secret browser",
			"push https://other.example/posts/1 browser",
			"push /posts/1 browser",
			"push /posts/1 browser",
		]);
		expect(handled).toHaveLength(0);
	});

	test("applies the router's redirects without a history entry", async () => {
		const {navigation, handled} = setup();
		navigation.dispatch("/old/7?x=1");
		navigation.dispatch("/posts/7/");
		await Promise.all(navigation.pending);

		expect(navigation.log).toEqual([
			"push /old/7?x=1 cancelled",
			"push /posts/7?x=1 intercepted",
			"push /posts/7/ cancelled",
			"push /posts/7 intercepted",
		]);
		expect(handled.map((nav) => nav.url.pathname)).toEqual([
			"/posts/7",
			"/posts/7",
		]);
	});

	test("a redirect to another origin goes to the browser", () => {
		const {navigation} = setup();
		navigation.dispatch("/away");
		expect(navigation.log).toEqual([
			"push /away cancelled",
			"push https://other.example/ browser",
		]);
	});

	test("a replace stays a replace, and a traversal's entry is replaced", () => {
		const {navigation} = setup();
		navigation.dispatch("/old/1", {navigationType: "replace"});
		navigation.dispatch("/old/2", {
			navigationType: "traverse",
			cancelable: false,
		});
		expect(navigation.log).toEqual([
			"replace /old/1 cancelled",
			"replace /posts/1 intercepted",
			"traverse /old/2 browser",
			"replace /posts/2 intercepted",
		]);
	});

	test("redirects that loop are left to the browser", () => {
		const {navigation, handled} = setup();
		navigation.dispatch("/a");
		expect(navigation.log).toEqual(["push /a browser"]);
		expect(handled).toHaveLength(0);
	});

	test("a form POST is matched by method", async () => {
		const {navigation, handled} = setup();
		const formData = new FormData();
		formData.set("title", "hello");
		navigation.dispatch("/posts/1", {formData});
		navigation.dispatch("/", {formData});
		await Promise.all(navigation.pending);

		expect(navigation.log).toEqual([
			"push /posts/1 intercepted",
			"push / browser",
		]);
		expect(handled[0].method).toBe("POST");
		expect(handled[0].formData?.get("title")).toBe("hello");
	});

	test("the handler can redirect, replacing the navigation", async () => {
		const navigation = new FakeNavigation();
		listen(
			Router.fromJSON(JSON.stringify(makeServer())),
			(nav) => {
				if (nav.route.params.id === "1") nav.redirect("/posts/2");
			},
			{navigation},
		);
		navigation.dispatch("/posts/1");
		await Promise.all(navigation.pending);
		expect(navigation.log).toEqual([
			"push /posts/1 intercepted",
			"replace /posts/2 intercepted",
		]);
	});

	test("stops listening, and does nothing without a Navigation API", () => {
		const {navigation, handled, stop} = setup();
		stop();
		navigation.dispatch("/posts/1");
		expect(navigation.log).toEqual(["push /posts/1 browser"]);
		expect(handled).toHaveLength(0);

		const noop = listen(new Router(), () => {});
		expect(() => noop()).not.toThrow();
	});
});

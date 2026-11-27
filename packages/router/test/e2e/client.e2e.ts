/**
 * End-to-end tests for @b9g/router/client in real browsers.
 *
 * Run with `bun run test:e2e`. It needs Playwright's browsers:
 * `bunx playwright install chromium firefox webkit`. Set E2E_BROWSERS to a
 * comma-separated list to run fewer, such as `E2E_BROWSERS=chromium`.
 */
import {
	test,
	expect,
	describe,
	beforeAll,
	afterAll,
	beforeEach,
} from "bun:test";
import {chromium, firefox, webkit} from "playwright";
import type {Browser, BrowserType, Page} from "playwright";
import {Router} from "../../src/index.js";
import {trailingSlash} from "../../src/middleware.js";

const browserTypes: Record<string, BrowserType> = {chromium, firefox, webkit};
const names = (import.meta.env.E2E_BROWSERS ?? "chromium,firefox,webkit")
	.split(",")
	.map((name) => name.trim())
	.filter(Boolean);

// ============================================================================
// The app under test
// ============================================================================

/** Document requests the server answered, as opposed to the client's fetches */
let documents: string[] = [];
let script = "";

function makeRouter(): Router {
	const router = new Router();

	/** A whole document for the browser, or only the content for the client */
	const page = (content: string, request: Request, status = 200): Response => {
		if (request.headers.get("X-Client")) {
			return new Response(content, {status});
		}
		const url = new URL(request.url);
		documents.push(url.pathname + url.search);
		return new Response(
			`<!doctype html>
<title>e2e</title>
<nav>
	<a id="home" href="/">home</a>
	<a id="post1" href="/posts/1">post 1</a>
	<a id="post2-slash" href="/posts/2/">post 2 with a slash</a>
	<a id="old" href="/old/7?x=1">old 7</a>
	<a id="gate" href="/gate">gate</a>
	<a id="secret" href="/secret">secret</a>
	<a id="missing" href="/missing">missing</a>
	<a id="loop" href="/a">loop</a>
	<a id="hash" href="#section">hash</a>
	<a id="download" href="/posts/1" download>download</a>
</nav>
<form id="form" method="post" action="/posts/5">
	<input name="title" value="hello">
	<button id="submit">save</button>
</form>
<div id="view">server: ${content}</div>
<div id="section">section</div>
<script>window.__ROUTES__ = ${JSON.stringify(JSON.stringify(router))}</script>
<script type="module" src="/app.js"></script>`,
			{status, headers: {"Content-Type": "text/html"}},
		);
	};

	router.use(trailingSlash("strip"));
	router.redirect("/old/:id", "/posts/:id");
	router.redirect("/a", "/b");
	router.redirect("/b", "/a");
	router.route("/", {name: "home"}).get((request) => page("home", request));
	router
		.route("/posts/:id", {name: "post"})
		.get((request, {params}) => page(`post ${params.id}`, request))
		.post(async (request, {params}) => {
			const title = (await request.formData()).get("title");
			return Response.redirect(
				new URL(`/posts/${params.id}?saved=${title}`, request.url),
				303,
			);
		});
	// Only the server knows this one redirects
	router
		.route("/gate", {name: "gate"})
		.get((request) => Response.redirect(new URL("/posts/1", request.url), 302));
	router
		.route("/secret", {serialize: false})
		.get((request) => page("secret", request));
	router
		.route("/app.js", {serialize: false})
		.get(
			() =>
				new Response(script, {headers: {"Content-Type": "text/javascript"}}),
		);
	return router;
}

// ============================================================================
// Helpers
// ============================================================================

/** Mark the document, so a later check can tell whether it was replaced */
async function mark(page: Page): Promise<void> {
	await page.evaluate(() => {
		(globalThis as any).__marked__ = true;
	});
}

async function sameDocument(page: Page): Promise<boolean> {
	return page.evaluate(() => (globalThis as any).__marked__ === true);
}

async function handled(page: Page): Promise<string[]> {
	return page.evaluate(() => (globalThis as any).__handled__);
}

async function entries(page: Page): Promise<string[]> {
	return page.evaluate(() =>
		(globalThis as any).navigation
			.entries()
			.map((entry: {url: string}) => new URL(entry.url).pathname),
	);
}

function view(page: Page): Promise<string | null> {
	return page.textContent("#view");
}

/** Wait for the handler to finish: the URL changes before it has rendered */
async function waitForView(page: Page, text: string): Promise<void> {
	await page.waitForFunction(
		(expected) =>
			(globalThis as any).document.getElementById("view").textContent ===
			expected,
		text,
	);
}

// ============================================================================
// Tests
// ============================================================================

for (const name of names) {
	describe(`@b9g/router/client in ${name}`, () => {
		let server: ReturnType<typeof Bun.serve>;
		let browser: Browser;
		let page: Page;
		let origin: string;

		beforeAll(async () => {
			const built = await Bun.build({
				entrypoints: [import.meta.dir + "/app.ts"],
				target: "browser",
			});
			if (!built.success) {
				throw new AggregateError(built.logs, "Could not build the page script");
			}
			script = await built.outputs[0].text();
			const router = makeRouter();
			server = Bun.serve({
				port: 0,
				hostname: "127.0.0.1",
				fetch: (request) => router.handle(request),
			});
			origin = `http://127.0.0.1:${server.port}`;
			browser = await browserTypes[name].launch();
		});

		afterAll(async () => {
			await browser?.close();
			await server?.stop(true);
		});

		beforeEach(async () => {
			await page?.context().close();
			page = await (await browser.newContext()).newPage();
			await page.goto(origin + "/");
			await page.waitForFunction(() => "__handled__" in globalThis);
			await mark(page);
			documents = [];
		});

		test("the browser has a Navigation API", async () => {
			expect(await page.evaluate(() => "navigation" in globalThis)).toBe(true);
		});

		test("a link to a route is handled without loading a document", async () => {
			await page.click("#post1");
			await page.waitForURL(origin + "/posts/1");
			await waitForView(page, "post: post 1");

			expect(await sameDocument(page)).toBe(true);
			expect(documents).toEqual([]);
			expect(await handled(page)).toEqual(["GET /posts/1"]);
			expect(await entries(page)).toEqual(["/", "/posts/1"]);
		});

		test("a redirect is applied on the client and leaves no history entry", async () => {
			await page.click("#old");
			await page.waitForURL(origin + "/posts/7?x=1");
			await waitForView(page, "post: post 7");

			expect(await sameDocument(page)).toBe(true);
			expect(documents).toEqual([]);
			expect(await handled(page)).toEqual(["GET /posts/7?x=1"]);
			expect(await entries(page)).toEqual(["/", "/posts/7"]);
		});

		test("trailingSlash() redirects on the client", async () => {
			await page.click("#post2-slash");
			await page.waitForURL(origin + "/posts/2");
			await waitForView(page, "post: post 2");

			expect(await sameDocument(page)).toBe(true);
			expect(await entries(page)).toEqual(["/", "/posts/2"]);
		});

		test("back and forward are handled too", async () => {
			await page.click("#post1");
			await waitForView(page, "post: post 1");
			await page.click("#post2-slash");
			await waitForView(page, "post: post 2");

			await page.goBack();
			await waitForView(page, "post: post 1");
			expect(page.url()).toBe(origin + "/posts/1");

			await page.goForward();
			await waitForView(page, "post: post 2");
			expect(page.url()).toBe(origin + "/posts/2");
			expect(await sameDocument(page)).toBe(true);
			expect(documents).toEqual([]);
		});

		test("a redirect only the server knows replaces the navigation", async () => {
			await page.click("#gate");
			await page.waitForURL(origin + "/posts/1");
			await waitForView(page, "post: post 1");

			expect(await sameDocument(page)).toBe(true);
			expect(await handled(page)).toEqual(["GET /gate", "GET /posts/1"]);
			// /gate does not stay in the history
			expect(await entries(page)).toEqual(["/", "/posts/1"]);
		});

		test("a form POST is handled, and its redirect followed", async () => {
			await page.click("#submit");
			await page.waitForURL(origin + "/posts/5?saved=hello");
			await waitForView(page, "post: post 5");

			expect(await sameDocument(page)).toBe(true);
			expect(await handled(page)).toEqual([
				"POST /posts/5",
				"GET /posts/5?saved=hello",
			]);
			expect(await entries(page)).toEqual(["/", "/posts/5"]);
		});

		test("a route left out of the serialized router loads from the server", async () => {
			await page.click("#secret");
			await page.waitForURL(origin + "/secret");
			await expect(view(page)).resolves.toBe("server: secret");

			expect(await sameDocument(page)).toBe(false);
			expect(documents).toEqual(["/secret"]);
		});

		test("a URL with no route loads from the server", async () => {
			const response = page.waitForResponse(origin + "/missing");
			await page.click("#missing");
			expect((await response).status()).toBe(404);
			await page.waitForURL(origin + "/missing");
			expect(await sameDocument(page)).toBe(false);
		});

		test("redirects that loop are left to the server, which refuses them", async () => {
			const response = page.waitForResponse(origin + "/a");
			await page.click("#loop");
			expect((await response).status()).toBe(404);
			await page.waitForURL(origin + "/a");
			expect(await sameDocument(page)).toBe(false);
		});

		test("a hash change is not handled", async () => {
			await page.click("#hash");
			await page.waitForURL(origin + "/#section");

			expect(await sameDocument(page)).toBe(true);
			expect(await handled(page)).toEqual([]);
			await expect(view(page)).resolves.toBe("server: home");
		});

		test("a download is not handled", async () => {
			// What the browser's own navigate event says about the click
			await page.evaluate(() => {
				const state = globalThis as any;
				state.__downloads__ = [];
				state.navigation.addEventListener("navigate", (event: any) => {
					state.__downloads__.push(
						[
							event.navigationType,
							new URL(event.destination.url).pathname,
							`download=${JSON.stringify(event.downloadRequest)}`,
							`canIntercept=${event.canIntercept}`,
							`userInitiated=${event.userInitiated}`,
							`sameDocument=${event.destination.sameDocument}`,
						].join(" "),
					);
				});
			});
			const download = page
				.waitForEvent("download", {timeout: 5000})
				.catch(() => null);
			await page.click("#download");
			await (await download)?.cancel();

			expect({
				events: await page.evaluate(() => (globalThis as any).__downloads__),
				handled: await handled(page),
				url: page.url(),
				view: await view(page),
			}).toEqual({
				events: [
					'push /posts/1 download="" canIntercept=true userInitiated=true sameDocument=false',
				],
				handled: [],
				url: origin + "/",
				view: "server: home",
			});
		});
	});
}

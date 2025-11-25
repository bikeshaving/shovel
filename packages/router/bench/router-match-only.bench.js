/**
 * Benchmark: Router matching only (no middleware, no Response creation)
 * This measures the pure routing performance improvement from radix tree
 */

import {bench, group, run} from "mitata";
import {Router} from "../src/index.ts";

// Create router with realistic route patterns
const router = new Router();

// Static routes
router.route("/").get(() => new Response("home"));
router.route("/about").get(() => new Response("about"));
router.route("/contact").get(() => new Response("contact"));
router.route("/pricing").get(() => new Response("pricing"));
router.route("/blog").get(() => new Response("blog"));
router.route("/docs").get(() => new Response("docs"));
router.route("/api/health").get(() => new Response("healthy"));
router.route("/api/status").get(() => new Response("ok"));
router.route("/api/version").get(() => new Response("1.0"));
router.route("/api/metrics").get(() => new Response("metrics"));

// Dynamic routes
router.route("/users/:id").get(() => new Response("user"));
router.route("/posts/:slug").get(() => new Response("post"));
router
	.route("/categories/:category/posts")
	.get(() => new Response("category posts"));
router.route("/api/users/:id").get(() => new Response("api user"));
router.route("/api/users/:id/posts").get(() => new Response("user posts"));
router.route("/api/users/:id/profile").get(() => new Response("user profile"));
router
	.route("/api/posts/:id/comments/:commentId")
	.get(() => new Response("comment"));

// Wildcard routes
router.route("/files/*").get(() => new Response("file"));
router.route("/static/*").get(() => new Response("static"));

// Pre-create requests (to exclude URL parsing from benchmark)
const requests = {
	staticFirst: new Request("http://localhost/"),
	staticMiddle: new Request("http://localhost/blog"),
	staticLast: new Request("http://localhost/api/metrics"),
	dynamicSimple: new Request("http://localhost/users/123"),
	dynamicNested: new Request("http://localhost/api/posts/789/comments/42"),
	wildcard: new Request("http://localhost/files/document.pdf"),
	notFound: new Request("http://localhost/nonexistent"),
};

// Warm up
for (let i = 0; i < 1000; i++) {
	await router.handler(requests.staticFirst);
}

console.info("Router benchmark (full handler including middleware):\n");

group("Static routes", () => {
	bench("first (/)", async () => {
		await router.handler(requests.staticFirst);
	});
	bench("middle (/blog)", async () => {
		await router.handler(requests.staticMiddle);
	});
	bench("last (/api/metrics)", async () => {
		await router.handler(requests.staticLast);
	});
});

group("Dynamic routes", () => {
	bench("simple (/users/:id)", async () => {
		await router.handler(requests.dynamicSimple);
	});
	bench("nested (/api/posts/:id/comments/:commentId)", async () => {
		await router.handler(requests.dynamicNested);
	});
});

group("Edge cases", () => {
	bench("wildcard (/files/*)", async () => {
		await router.handler(requests.wildcard);
	});
	bench("not found", async () => {
		await router.handler(requests.notFound);
	});
});

run();

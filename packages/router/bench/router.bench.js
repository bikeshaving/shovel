/**
 * Router performance benchmarks using mitata
 *
 * Measures:
 * - Static route matching (start, middle, end of route list)
 * - Dynamic route matching with parameters
 * - Wildcard route matching
 * - Mixed workload
 */

import {bench, group, run} from "mitata";
import {Router} from "../src/index.ts";

// Create router with realistic route patterns
const router = new Router();

// Static routes (common case - should be fast)
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

// Dynamic routes (need parameter extraction)
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

// Wildcard routes (pattern matching)
router.route("/files/*").get(() => new Response("file"));
router.route("/static/*").get(() => new Response("static"));

// Test requests
const firstStaticReq = new Request("http://localhost/");
const middleStaticReq = new Request("http://localhost/blog");
const lastStaticReq = new Request("http://localhost/api/metrics");

const simpleDynamicReq = new Request("http://localhost/users/123");
const nestedDynamicReq = new Request(
	"http://localhost/api/posts/789/comments/42",
);

const wildcardReq = new Request("http://localhost/files/document.pdf");

const notFoundReq = new Request("http://localhost/nonexistent");

// Warm up the router
for (let i = 0; i < 1000; i++) {
	await router.handler(firstStaticReq);
	await router.handler(simpleDynamicReq);
}

// Benchmarks
group("Static routes (position matters in linear scan)", () => {
	bench("first route (/)", async () => {
		await router.handler(firstStaticReq);
	});

	bench("middle route (/blog)", async () => {
		await router.handler(middleStaticReq);
	});

	bench("last route (/api/metrics)", async () => {
		await router.handler(lastStaticReq);
	});
});

group("Dynamic routes (parameter extraction overhead)", () => {
	bench("simple param (/users/:id)", async () => {
		await router.handler(simpleDynamicReq);
	});

	bench("nested params (/api/posts/:id/comments/:commentId)", async () => {
		await router.handler(nestedDynamicReq);
	});
});

group("Edge cases", () => {
	bench("wildcard route (/files/*)", async () => {
		await router.handler(wildcardReq);
	});

	bench("404 not found", async () => {
		await router.handler(notFoundReq);
	});
});

// Mixed workload
const mixedRequests = [
	firstStaticReq,
	middleStaticReq,
	lastStaticReq,
	simpleDynamicReq,
	nestedDynamicReq,
	wildcardReq,
];

let mixedIdx = 0;
group("Mixed workload", () => {
	bench("realistic mix of routes", async () => {
		await router.handler(mixedRequests[mixedIdx++ % mixedRequests.length]);
	});
});

run();

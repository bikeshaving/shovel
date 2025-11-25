/**
 * Benchmark MatchPattern vs URLPattern polyfill vs Node native
 */

import {bench, group, run} from "mitata";
import {MatchPattern} from "../src/index.ts";

// Import polyfill directly without mutating globals
import {URLPattern as URLPatternPolyfill} from "urlpattern-polyfill/urlpattern";

// Test URLs
const staticUrl = new URL("http://localhost/api/users");
const dynamicUrl = new URL("http://localhost/users/123");
const fullUrl = new URL("https://api.example.com/v1/posts/456");

// MatchPattern instances
const mpStatic = new MatchPattern({pathname: "/api/users"});
const mpDynamic = new MatchPattern({pathname: "/users/:id"});
const mpFull = new MatchPattern("https://api.example.com/v1/posts/:id");

// URLPattern polyfill instances
const upStatic = new URLPatternPolyfill({pathname: "/api/users"});
const upDynamic = new URLPatternPolyfill({pathname: "/users/:id"});
const upFull = new URLPatternPolyfill("https://api.example.com/v1/posts/:id");

// Pure RegExp for baseline
const reStatic = /^\/api\/users$/;
const reDynamic = /^\/users\/([^\/]+)$/;

group("Construction", () => {
	bench("MatchPattern (simple)", () => {
		new MatchPattern({pathname: "/users/:id"});
	});

	bench("URLPattern polyfill (simple)", () => {
		new URLPatternPolyfill({pathname: "/users/:id"});
	});

	bench("MatchPattern (full URL)", () => {
		new MatchPattern("https://api.example.com/v1/posts/:id");
	});

	bench("URLPattern polyfill (full URL)", () => {
		new URLPatternPolyfill("https://api.example.com/v1/posts/:id");
	});

	bench("RegExp (baseline)", () => {
		new RegExp("^/users/([^/]+)$");
	});
});

group("Static route test()", () => {
	bench("MatchPattern", () => {
		mpStatic.test(staticUrl);
	});

	bench("URLPattern polyfill", () => {
		upStatic.test(staticUrl);
	});

	bench("RegExp.test()", () => {
		reStatic.test(staticUrl.pathname);
	});
});

group("Dynamic route test()", () => {
	bench("MatchPattern", () => {
		mpDynamic.test(dynamicUrl);
	});

	bench("URLPattern polyfill", () => {
		upDynamic.test(dynamicUrl);
	});

	bench("RegExp.test()", () => {
		reDynamic.test(dynamicUrl.pathname);
	});
});

group("Full URL test()", () => {
	bench("MatchPattern", () => {
		mpFull.test(fullUrl);
	});

	bench("URLPattern polyfill", () => {
		upFull.test(fullUrl);
	});
});

group("Dynamic route exec()", () => {
	bench("MatchPattern", () => {
		mpDynamic.exec(dynamicUrl);
	});

	bench("URLPattern polyfill", () => {
		upDynamic.exec(dynamicUrl);
	});
});

run();

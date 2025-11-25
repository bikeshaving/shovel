/**
 * Benchmark URLPattern operations to understand where the cost is
 * Run with Node.js for native URLPattern, or Bun with polyfill
 */

import {bench, group, run} from "mitata";

// Load polyfill only if needed (Bun doesn't have native URLPattern)
if (typeof globalThis.URLPattern === "undefined") {
	await import("urlpattern-polyfill");
	console.log("Using URLPattern polyfill (Bun)");
} else {
	console.log("Using native URLPattern (Node.js)");
}

// Test URLs
const staticUrl = new URL("http://localhost/api/users");
const dynamicUrl = new URL("http://localhost/users/123");

// URLPattern instances
const staticPattern = new URLPattern({pathname: "/api/users"});
const dynamicPattern = new URLPattern({pathname: "/users/:id"});

// Manual regex patterns (what we could do instead)
const staticRegex = /^\/api\/users$/;
const dynamicRegex = /^\/users\/([^\/]+)$/;

// Manual path extraction
function extractParams(pathname, regex, paramNames) {
	const match = pathname.match(regex);
	if (!match) return null;

	const params = {};
	for (let i = 0; i < paramNames.length; i++) {
		params[paramNames[i]] = match[i + 1];
	}
	return params;
}

group("Static route: URLPattern vs alternatives", () => {
	bench("URLPattern.test()", () => {
		staticPattern.test(staticUrl);
	});

	bench("String comparison", () => {
		staticUrl.pathname === "/api/users";
	});

	bench("RegExp.test()", () => {
		staticRegex.test(staticUrl.pathname);
	});
});

group("Dynamic route: URLPattern vs RegExp", () => {
	bench("URLPattern.test() + exec()", () => {
		if (dynamicPattern.test(dynamicUrl)) {
			dynamicPattern.exec(dynamicUrl);
		}
	});

	bench("URLPattern.exec() only (combined test+exec)", () => {
		dynamicPattern.exec(dynamicUrl);
	});

	bench("RegExp.exec() + extract params", () => {
		extractParams(dynamicUrl.pathname, dynamicRegex, ["id"]);
	});
});

group("Construction cost", () => {
	bench("new URLPattern()", () => {
		new URLPattern({pathname: "/users/:id"});
	});

	bench("new RegExp()", () => {
		new RegExp("^/users/([^/]+)$");
	});
});

run();

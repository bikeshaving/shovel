/**
 * Benchmark URLPattern implementations
 */

import {bench, group, run} from "mitata";
import {URLPattern as ShovelURLPattern, MatchPattern} from "../src/index.ts";
import {URLPattern as PolyfillURLPattern} from "urlpattern-polyfill";

// Native URLPattern (Node.js only)
const NativeURLPattern = globalThis.URLPattern;

// Test URLs
const staticUrl = new URL("http://localhost/api/users");
const dynamicUrl = new URL("http://localhost/users/123");

// Shovel patterns
const shovelStaticPattern = new ShovelURLPattern({pathname: "/api/users"});
const shovelDynamicPattern = new ShovelURLPattern({pathname: "/users/:id"});

// MatchPattern (convenience wrapper)
const matchStaticPattern = new MatchPattern({pathname: "/api/users"});
const matchDynamicPattern = new MatchPattern({pathname: "/users/:id"});

// Polyfill patterns
const polyfillStaticPattern = new PolyfillURLPattern({pathname: "/api/users"});
const polyfillDynamicPattern = new PolyfillURLPattern({pathname: "/users/:id"});

// Native patterns (if available)
const nativeStaticPattern = NativeURLPattern
	? new NativeURLPattern({pathname: "/api/users"})
	: null;
const nativeDynamicPattern = NativeURLPattern
	? new NativeURLPattern({pathname: "/users/:id"})
	: null;

// Manual regex patterns (baseline)
const staticRegex = /^\/api\/users$/;
const dynamicRegex = /^\/users\/([^/]+)$/;

function extractParams(pathname, regex, paramNames) {
	const match = pathname.match(regex);
	if (!match) return null;
	const params = {};
	for (let i = 0; i < paramNames.length; i++) {
		params[paramNames[i]] = match[i + 1];
	}
	return params;
}

group("Static route: test()", () => {
	bench("Shovel URLPattern", () => {
		shovelStaticPattern.test(staticUrl);
	});

	bench("Shovel MatchPattern", () => {
		matchStaticPattern.test(staticUrl);
	});

	bench("urlpattern-polyfill", () => {
		polyfillStaticPattern.test(staticUrl);
	});

	if (nativeStaticPattern) {
		bench("Native URLPattern", () => {
			nativeStaticPattern.test(staticUrl);
		});
	}

	bench("RegExp.test()", () => {
		staticRegex.test(staticUrl.pathname);
	});
});

group("Dynamic route: exec()", () => {
	bench("Shovel URLPattern", () => {
		shovelDynamicPattern.exec(dynamicUrl);
	});

	bench("Shovel MatchPattern", () => {
		matchDynamicPattern.exec(dynamicUrl);
	});

	bench("urlpattern-polyfill", () => {
		polyfillDynamicPattern.exec(dynamicUrl);
	});

	if (nativeDynamicPattern) {
		bench("Native URLPattern", () => {
			nativeDynamicPattern.exec(dynamicUrl);
		});
	}

	bench("RegExp + extractParams", () => {
		extractParams(dynamicUrl.pathname, dynamicRegex, ["id"]);
	});
});

group("Construction cost", () => {
	bench("Shovel URLPattern", () => {
		new ShovelURLPattern({pathname: "/users/:id"});
	});

	bench("Shovel MatchPattern", () => {
		new MatchPattern({pathname: "/users/:id"});
	});

	bench("urlpattern-polyfill", () => {
		new PolyfillURLPattern({pathname: "/users/:id"});
	});

	if (NativeURLPattern) {
		bench("Native URLPattern", () => {
			new NativeURLPattern({pathname: "/users/:id"});
		});
	}

	bench("new RegExp()", () => {
		new RegExp("^/users/([^/]+)$");
	});
});

console.info("Native URLPattern available:", !!NativeURLPattern);
console.info("");

run();

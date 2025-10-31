#!/usr/bin/env bun

import * as URL_builtin from "url";

let URLPattern = URL_builtin.URLPattern || globalThis.URLPattern;
if (!URLPattern) {
	await import("urlpattern-polyfill");
	URLPattern = globalThis.URLPattern;
}

console.log("Testing URLPattern existing features...\n");

// Test wildcards and optional parameters
console.log("=== URLPattern Wildcards and Optionals ===");

try {
	// Test wildcard syntax
	const pattern1 = new URLPattern({search: "q=*"});
	const url1 = new URL("http://example.com/test?q=hello");
	console.log("Wildcard pattern (q=*):", pattern1.test(url1));
	console.log("Wildcard result:", pattern1.exec(url1)?.search?.groups);
} catch (err) {
	console.log("Wildcard error:", err.message);
}

try {
	// Test optional syntax
	const pattern2 = new URLPattern({search: "q=:query?"});
	const url2a = new URL("http://example.com/test?q=hello");
	const url2b = new URL("http://example.com/test");
	console.log("Optional pattern (q=:query?)");
	console.log("  With param:", pattern2.test(url2a));
	console.log("  Without param:", pattern2.test(url2b));
} catch (err) {
	console.log("Optional error:", err.message);
}

try {
	// Test pathname optionals
	const pattern3 = new URLPattern({pathname: "/api/posts/:id?"});
	const url3a = new URL("http://example.com/api/posts/123");
	const url3b = new URL("http://example.com/api/posts");
	console.log("Optional pathname (posts/:id?)");
	console.log("  With id:", pattern3.test(url3a));
	console.log("  Without id:", pattern3.test(url3b));
} catch (err) {
	console.log("Pathname optional error:", err.message);
}

console.log("\n=== URLPattern Advanced Syntax ===");

try {
	// Test groups
	const pattern4 = new URLPattern({pathname: "/files/(*)"});
	const url4 = new URL("http://example.com/files/docs/readme.txt");
	console.log("Group pattern files/(*):");
	console.log("  Match:", pattern4.test(url4));
	console.log("  Groups:", pattern4.exec(url4)?.pathname?.groups);
} catch (err) {
	console.log("Group error:", err.message);
}

try {
	// Test regex-like patterns
	const pattern5 = new URLPattern({pathname: "/api/:version(v\\d+)"});
	const url5a = new URL("http://example.com/api/v1");
	const url5b = new URL("http://example.com/api/beta");
	console.log("Regex pattern :version(v\\d+):");
	console.log("  v1:", pattern5.test(url5a));
	console.log("  beta:", pattern5.test(url5b));
} catch (err) {
	console.log("Regex error:", err.message);
}

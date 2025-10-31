#!/usr/bin/env bun

// Test script to document URLPattern's limitations for routing

import * as URL_builtin from "url";

// Get URLPattern from Node's url module, global, or polyfill
let URLPattern = URL_builtin.URLPattern || globalThis.URLPattern;

if (!URLPattern) {
	await import("urlpattern-polyfill");
	URLPattern = globalThis.URLPattern;
}

console.log("Testing URLPattern limitations...\n");

// Test 1: Search parameter matching behavior
console.log("=== Test 1: Search Parameter Matching ===");

const pattern1 = new URLPattern({
	pathname: "/api/posts",
	search: "type=blog&sort=date",
});
const url1a = new URL("http://example.com/api/posts?type=blog&sort=date");
const url1b = new URL("http://example.com/api/posts?sort=date&type=blog"); // Different order
const url1c = new URL(
	"http://example.com/api/posts?type=blog&sort=date&extra=value",
); // Extra param

console.log("Pattern:", pattern1.search);
console.log("URL 1a (exact match):", url1a.search, "→", pattern1.test(url1a));
console.log(
	"URL 1b (different order):",
	url1b.search,
	"→",
	pattern1.test(url1b),
);
console.log("URL 1c (extra param):", url1c.search, "→", pattern1.test(url1c));
console.log("Expected: All should match for flexible routing\n");

// Test 2: String parameter parsing
console.log("=== Test 2: String Parameter Parsing ===");

try {
	const pattern2 = new URLPattern("/api/posts/:id");
	const url2 = new URL("http://example.com/api/posts/123");
	const result2 = pattern2.exec(url2);
	console.log("Pattern from string:", "/api/posts/:id");
	console.log("URL:", url2.pathname);
	console.log("Match result:", result2?.pathname?.groups);
} catch (err) {
	console.log("Error with string pattern:", err.message);
}

try {
	const pattern2b = new URLPattern({pathname: "/api/posts/:id"});
	const url2b = new URL("http://example.com/api/posts/123");
	const result2b = pattern2b.exec(url2b);
	console.log("Pattern from object:", '{ pathname: "/api/posts/:id" }');
	console.log("URL:", url2b.pathname);
	console.log("Match result:", result2b?.pathname?.groups);
} catch (err) {
	console.log("Error with object pattern:", err.message);
}
console.log();

// Test 3: Complex routing scenarios
console.log("=== Test 3: Complex Routing Scenarios ===");

const pattern3 = new URLPattern({pathname: "/api/:version/posts/:id"});
const url3 = new URL("http://example.com/api/v1/posts/123?format=json");

console.log("Pattern:", pattern3.pathname);
console.log("URL:", url3.pathname + url3.search);

const result3 = pattern3.exec(url3);
console.log("Pathname groups:", result3?.pathname?.groups);
console.log("Search params:", Object.fromEntries(url3.searchParams));
console.log("Combined params should be merged for routing context\n");

// Test 4: Non-exhaustive search matching
console.log("=== Test 4: Non-exhaustive Search Matching ===");

const pattern4 = new URLPattern({pathname: "/search", search: "q=:query"});
const url4a = new URL("http://example.com/search?q=hello");
const url4b = new URL("http://example.com/search?q=hello&page=1");
const url4c = new URL("http://example.com/search?q=hello&page=1&limit=10");

console.log("Pattern search:", pattern4.search);
console.log("URL 4a (exact):", url4a.search, "→", pattern4.test(url4a));
console.log("URL 4b (with page):", url4b.search, "→", pattern4.test(url4b));
console.log(
	"URL 4c (with page & limit):",
	url4c.search,
	"→",
	pattern4.test(url4c),
);
console.log("For routing, we want non-exhaustive matching (should all pass)\n");

// Test 5: Full URL string patterns
console.log("=== Test 5: Full URL String Patterns ===");

try {
	const pattern5 = new URLPattern("https://api.example.com/v1/posts/:id");
	const url5 = new URL("https://api.example.com/v1/posts/123");
	const result5 = pattern5.exec(url5);
	console.log("Full URL pattern:", "https://api.example.com/v1/posts/:id");
	console.log("URL:", url5.href);
	console.log("Match result:", result5?.pathname?.groups);
} catch (err) {
	console.log("Error with full URL pattern:", err.message);
}

console.log("\n=== Summary ===");
console.log("URLPattern limitations for routing:");
console.log(
	"1. Search params must match exactly (order matters, no extra params)",
);
console.log("2. String parameter parsing may be limited");
console.log("3. No automatic merging of pathname and search params");
console.log("4. Exhaustive search matching (not flexible for optional params)");
console.log("5. Complex URL string parsing might have edge cases");

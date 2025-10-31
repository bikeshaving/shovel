#!/usr/bin/env bun

import * as URL_builtin from "url";

let URLPattern = URL_builtin.URLPattern || globalThis.URLPattern;
if (!URLPattern) {
	await import("urlpattern-polyfill");
	URLPattern = globalThis.URLPattern;
}

console.log("Testing URLPattern exhaustive search behavior...\n");

// Test if URLPattern allows extra search parameters
const pattern = new URLPattern({search: "q=:query"});

const urls = [
	"http://example.com/search?q=hello", // Exact match
	"http://example.com/search?q=hello&page=1", // Extra param
	"http://example.com/search?q=hello&page=1&limit=10", // Multiple extra params
	"http://example.com/search?page=1&q=hello", // Extra param + different order
];

console.log('Pattern: { search: "q=:query" }');
console.log("");

urls.forEach((urlStr, i) => {
	const url = new URL(urlStr);
	const matches = pattern.test(url);
	const result = pattern.exec(url);

	console.log(`URL ${i + 1}: ${url.search}`);
	console.log(`  Matches: ${matches}`);
	if (matches && result?.search?.groups) {
		console.log(`  Captured: ${JSON.stringify(result.search.groups)}`);
	}
	console.log("");
});

// Test empty search pattern
console.log("=== Empty Search Pattern ===");
const emptyPattern = new URLPattern({pathname: "/test"});
const testUrls = [
	"http://example.com/test",
	"http://example.com/test?anything=value",
];

testUrls.forEach((urlStr) => {
	const url = new URL(urlStr);
	const matches = emptyPattern.test(url);
	console.log(`${url.pathname}${url.search} → ${matches}`);
});

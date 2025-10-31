import * as URL_builtin from "url";

// Check Node.js URLPattern
console.log("=== Node.js URLPattern ===");
if (URL_builtin.URLPattern) {
	const pattern = new URL_builtin.URLPattern({pathname: "/test"});
	const url = new URL("http://example.com/test");
	const result = pattern.exec(url);

	console.log(
		"Pattern methods:",
		Object.getOwnPropertyNames(Object.getPrototypeOf(pattern)),
	);
	console.log("Result structure:", result ? Object.keys(result) : "null");
	if (result) {
		console.log(
			"Result.inputs type:",
			typeof result.inputs,
			Array.isArray(result.inputs),
			result.inputs.length,
		);
		console.log("Result.pathname structure:", Object.keys(result.pathname));
		console.log("First input:", result.inputs[0]);
	}
}

// Check polyfill URLPattern
console.log("\n=== Polyfill URLPattern ===");
if (!globalThis.URLPattern) {
	await import("urlpattern-polyfill");
}

if (globalThis.URLPattern) {
	const pattern = new globalThis.URLPattern({pathname: "/test"});
	const url = new URL("http://example.com/test");
	const result = pattern.exec(url);

	console.log(
		"Pattern methods:",
		Object.getOwnPropertyNames(Object.getPrototypeOf(pattern)),
	);
	console.log("Result structure:", result ? Object.keys(result) : "null");
	if (result) {
		console.log(
			"Result.inputs type:",
			typeof result.inputs,
			Array.isArray(result.inputs),
			result.inputs.length,
		);
		console.log("Result.pathname structure:", Object.keys(result.pathname));
		console.log("First input:", result.inputs[0]);
	}
}

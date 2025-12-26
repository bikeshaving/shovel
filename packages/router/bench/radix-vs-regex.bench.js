/* eslint-disable no-console */
/**
 * Benchmark: Radix Tree vs MatchPattern regex for route matching
 *
 * Tests the core hypothesis: is regex-based matching faster than tree traversal
 * for typical web routing scenarios?
 */

import {bench, group, run} from "mitata";
import {
	MatchPattern,
	isSimplePattern,
	compilePathname,
} from "@b9g/match-pattern";

// ============================================================================
// RADIX TREE IMPLEMENTATION (simplified)
// ============================================================================

class RadixNode {
	constructor() {
		this.children = new Map(); // char -> RadixNode
		this.param = null; // param name if this is a :param segment
		this.wildcard = false; // true if this is a * wildcard
		this.handler = null; // handler if this is a terminal node
		this.paramChildren = null; // RadixNode for :param children
	}
}

class RadixTree {
	constructor() {
		this.root = new RadixNode();
	}

	add(pattern, handler) {
		const segments = pattern.split("/").filter(Boolean);
		let node = this.root;

		for (const segment of segments) {
			if (segment.startsWith(":")) {
				// Parameter segment
				if (!node.paramChildren) {
					node.paramChildren = new RadixNode();
					node.paramChildren.param = segment.slice(1);
				}
				node = node.paramChildren;
			} else if (segment === "*") {
				// Wildcard
				if (!node.paramChildren) {
					node.paramChildren = new RadixNode();
					node.paramChildren.wildcard = true;
				}
				node = node.paramChildren;
				break; // Wildcard consumes rest
			} else {
				// Static segment - character by character
				for (const char of "/" + segment) {
					if (!node.children.has(char)) {
						node.children.set(char, new RadixNode());
					}
					node = node.children.get(char);
				}
			}
		}

		// Handle root path
		if (segments.length === 0) {
			if (!this.root.children.has("/")) {
				this.root.children.set("/", new RadixNode());
			}
			this.root.children.get("/").handler = handler;
		} else {
			node.handler = handler;
		}
	}

	match(pathname) {
		const params = {};
		const segments = pathname.split("/").filter(Boolean);
		let node = this.root;

		// Handle root path
		if (segments.length === 0) {
			const rootNode = node.children.get("/");
			if (rootNode?.handler) {
				return {handler: rootNode.handler, params: {}};
			}
			return null;
		}

		for (let i = 0; i < segments.length; i++) {
			const segment = segments[i];
			const segmentWithSlash = "/" + segment;

			// Try static match first (character by character)
			let staticNode = node;
			let matched = true;
			for (const char of segmentWithSlash) {
				if (staticNode.children.has(char)) {
					staticNode = staticNode.children.get(char);
				} else {
					matched = false;
					break;
				}
			}

			if (matched) {
				node = staticNode;
				continue;
			}

			// Try param match
			if (node.paramChildren) {
				if (node.paramChildren.wildcard) {
					// Wildcard - capture rest
					params["*"] = segments.slice(i).join("/");
					return {handler: node.paramChildren.handler, params};
				}
				// Regular param
				params[node.paramChildren.param] = segment;
				node = node.paramChildren;
				continue;
			}

			// No match
			return null;
		}

		if (node.handler) {
			return {handler: node.handler, params};
		}

		return null;
	}
}

// ============================================================================
// MATCHPATTERN-BASED MATCHER (current approach)
// ============================================================================

class RegexMatcher {
	constructor() {
		this.routes = [];
	}

	add(pattern, handler) {
		this.routes.push({
			pattern: new MatchPattern(pattern),
			handler,
		});
	}

	match(pathname) {
		for (const route of this.routes) {
			const result = route.pattern.exec({pathname});
			if (result) {
				return {handler: route.handler, params: result.params};
			}
		}
		return null;
	}
}

// ============================================================================
// HYBRID MATCHER (radix for simple, regex for complex)
// ============================================================================

class HybridMatcher {
	constructor() {
		this.radixTree = new RadixTree();
		this.complexRoutes = [];
	}

	add(pattern, handler) {
		if (isSimplePattern(pattern)) {
			// Use radix tree for simple patterns
			this.radixTree.add(pattern, handler);
		} else {
			// Use compiled regex for complex patterns
			const compiled = compilePathname(pattern);
			this.complexRoutes.push({
				regex: compiled.regex,
				paramNames: compiled.paramNames,
				handler,
			});
		}
	}

	match(pathname) {
		// Try radix tree first (fast path for simple routes)
		const radixResult = this.radixTree.match(pathname);
		if (radixResult) {
			return radixResult;
		}

		// Fall back to regex for complex routes
		for (const route of this.complexRoutes) {
			const match = pathname.match(route.regex);
			if (match) {
				const params = {};
				for (let i = 0; i < route.paramNames.length; i++) {
					if (match[i + 1] !== undefined) {
						params[route.paramNames[i]] = match[i + 1];
					}
				}
				return {handler: route.handler, params};
			}
		}

		return null;
	}
}

// ============================================================================
// SETUP: Add same routes to both
// ============================================================================

const routes = [
	// Static routes
	"/",
	"/about",
	"/contact",
	"/pricing",
	"/blog",
	"/docs",
	"/api/health",
	"/api/status",
	"/api/version",
	"/api/metrics",
	// Dynamic routes
	"/users/:id",
	"/posts/:slug",
	"/categories/:category/posts",
	"/api/users/:id",
	"/api/users/:id/posts",
	"/api/users/:id/profile",
	"/api/posts/:id/comments/:commentId",
	// Wildcards
	"/files/*",
	"/static/*",
];

const radixTree = new RadixTree();
const regexMatcher = new RegexMatcher();
const hybridMatcher = new HybridMatcher();

const handler = () => {};
for (const route of routes) {
	radixTree.add(route, handler);
	regexMatcher.add(route, handler);
	hybridMatcher.add(route, handler);
}

// Test paths
const testPaths = {
	staticFirst: "/",
	staticMiddle: "/blog",
	staticLast: "/api/metrics",
	dynamicSimple: "/users/123",
	dynamicNested: "/api/posts/789/comments/42",
	wildcard: "/files/documents/report.pdf",
	notFound: "/nonexistent/path/here",
};

// Verify all implementations match
console.info("Verifying implementations match...");
for (const [name, path] of Object.entries(testPaths)) {
	const radixResult = radixTree.match(path);
	const regexResult = regexMatcher.match(path);
	const hybridResult = hybridMatcher.match(path);
	const radixMatched = radixResult !== null;
	const regexMatched = regexResult !== null;
	const hybridMatched = hybridResult !== null;
	console.info(
		`  ${name}: radix=${radixMatched}, regex=${regexMatched}, hybrid=${hybridMatched}`,
	);
	if (radixMatched !== regexMatched || radixMatched !== hybridMatched) {
		console.info(`    MISMATCH!`);
	}
}
console.info("");

// ============================================================================
// BENCHMARKS
// ============================================================================

group("Static route: first (/)", () => {
	bench("Radix Tree", () => {
		radixTree.match("/");
	});
	bench("MatchPattern", () => {
		regexMatcher.match("/");
	});
	bench("Hybrid", () => {
		hybridMatcher.match("/");
	});
});

group("Static route: middle (/blog)", () => {
	bench("Radix Tree", () => {
		radixTree.match("/blog");
	});
	bench("MatchPattern", () => {
		regexMatcher.match("/blog");
	});
	bench("Hybrid", () => {
		hybridMatcher.match("/blog");
	});
});

group("Static route: last (/api/metrics)", () => {
	bench("Radix Tree", () => {
		radixTree.match("/api/metrics");
	});
	bench("MatchPattern", () => {
		regexMatcher.match("/api/metrics");
	});
	bench("Hybrid", () => {
		hybridMatcher.match("/api/metrics");
	});
});

group("Dynamic route: simple (/users/:id)", () => {
	bench("Radix Tree", () => {
		radixTree.match("/users/123");
	});
	bench("MatchPattern", () => {
		regexMatcher.match("/users/123");
	});
	bench("Hybrid", () => {
		hybridMatcher.match("/users/123");
	});
});

group("Dynamic route: nested params", () => {
	bench("Radix Tree", () => {
		radixTree.match("/api/posts/789/comments/42");
	});
	bench("MatchPattern", () => {
		regexMatcher.match("/api/posts/789/comments/42");
	});
	bench("Hybrid", () => {
		hybridMatcher.match("/api/posts/789/comments/42");
	});
});

group("Wildcard route", () => {
	bench("Radix Tree", () => {
		radixTree.match("/files/documents/report.pdf");
	});
	bench("MatchPattern", () => {
		regexMatcher.match("/files/documents/report.pdf");
	});
	bench("Hybrid", () => {
		hybridMatcher.match("/files/documents/report.pdf");
	});
});

group("Not found (worst case)", () => {
	bench("Radix Tree", () => {
		radixTree.match("/nonexistent/path/here");
	});
	bench("MatchPattern", () => {
		regexMatcher.match("/nonexistent/path/here");
	});
	bench("Hybrid", () => {
		hybridMatcher.match("/nonexistent/path/here");
	});
});

// Many routes test
const manyRoutesRadix = new RadixTree();
const manyRoutesRegex = new RegexMatcher();
const manyRoutesHybrid = new HybridMatcher();

// Add 100 routes
for (let i = 0; i < 100; i++) {
	const route = `/api/v${Math.floor(i / 10)}/resource${i % 10}/:id`;
	manyRoutesRadix.add(route, handler);
	manyRoutesRegex.add(route, handler);
	manyRoutesHybrid.add(route, handler);
}

group("Many routes (100): match last route", () => {
	bench("Radix Tree", () => {
		manyRoutesRadix.match("/api/v9/resource9/abc123");
	});
	bench("MatchPattern (linear)", () => {
		manyRoutesRegex.match("/api/v9/resource9/abc123");
	});
	bench("Hybrid", () => {
		manyRoutesHybrid.match("/api/v9/resource9/abc123");
	});
});

group("Many routes (100): match first route", () => {
	bench("Radix Tree", () => {
		manyRoutesRadix.match("/api/v0/resource0/abc123");
	});
	bench("MatchPattern (linear)", () => {
		manyRoutesRegex.match("/api/v0/resource0/abc123");
	});
	bench("Hybrid", () => {
		manyRoutesHybrid.match("/api/v0/resource0/abc123");
	});
});

// Test with complex patterns (where hybrid should fall back to regex)
const complexRoutes = [
	"/api/v1/users/:id(\\d+)", // param with constraint
	"/api/v1/posts/:id(\\d+)/comments",
	"/api/v1/files/:path+", // repeat modifier
	"/api/v1/search{/category}?", // optional group
];

const complexRegex = new RegexMatcher();
const complexHybrid = new HybridMatcher();

for (const route of complexRoutes) {
	complexRegex.add(route, handler);
	complexHybrid.add(route, handler);
}

group("Complex patterns (regex fallback)", () => {
	bench("MatchPattern", () => {
		complexRegex.match("/api/v1/users/123");
	});
	bench("Hybrid (falls back to regex)", () => {
		complexHybrid.match("/api/v1/users/123");
	});
});

run();

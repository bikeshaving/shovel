// Get URLPattern from global or polyfill (Node.js has it globally now)
let URLPattern = (globalThis as any).URLPattern;

// Fall back to polyfill if not available (mainly for Bun)
if (!URLPattern) {
	await import("urlpattern-polyfill");
	URLPattern = (globalThis as any).URLPattern;
}

// Use the canonical URLPattern types from WHATWG specification
type URLPatternInput = URLPatternInit | string;

interface URLPatternComponentResult {
	input: string;
	groups: Record<string, string | undefined>;
}

interface URLPatternResult {
	inputs: URLPatternInput[]; // Array, not tuple - per WHATWG spec
	protocol: URLPatternComponentResult;
	username: URLPatternComponentResult;
	password: URLPatternComponentResult;
	hostname: URLPatternComponentResult;
	port: URLPatternComponentResult;
	pathname: URLPatternComponentResult;
	search: URLPatternComponentResult;
	hash: URLPatternComponentResult;
}

/**
 * Enhanced URLPattern result that includes unified params
 */
export interface MatchPatternResult extends URLPatternResult {
	params: Record<string, string>;
}

/**
 * Parameter definition for search pattern parsing
 */
interface ParamDefinition {
	type: "named" | "wildcard" | "literal";
	name?: string;
	value?: string;
	optional?: boolean;
}

/**
 * MatchPattern extends URLPattern with enhanced routing capabilities:
 * - Order-independent search parameter matching
 * - Non-exhaustive search matching (extra params allowed)
 * - Unified parameter extraction (pathname + search + extras)
 * - Enhanced string pattern parsing with & syntax
 */
export class MatchPattern extends URLPattern {
	private _originalInput: string | URLPatternInit;

	constructor(input: string | URLPatternInit, baseURL?: string) {
		// Handle string patterns with & syntax
		let processedInput = input;
		if (typeof input === "string") {
			processedInput = parseStringPattern(input);
		}

		// Normalize trailing slashes in the pattern
		const normalizedInput = normalizePatternTrailingSlash(processedInput);

		// Handle baseURL parameter properly - only pass if defined
		if (baseURL !== undefined) {
			super(normalizedInput as URLPatternInit, baseURL);
		} else {
			super(normalizedInput);
		}

		// Store original pattern for enhanced matching
		this._originalInput = normalizedInput;
	}


	/**
	 * Enhanced exec that returns unified params object with trailing slash normalization
	 */
	override exec(input: string | URL): MatchPatternResult | null {
		// First check if this would match with our enhanced test
		if (!this.test(input)) {
			return null;
		}

		// Normalize input URL for consistent matching
		const url = typeof input === "string" ? new URL(input) : input;
		const normalizedUrl = normalizeTrailingSlash(url);

		// Try URLPattern first with normalized URL - if it works, use it
		const result = super.exec(normalizedUrl);
		if (result) {
			// Add unified params object using canonical types, but use original URL for search params
			const enhancedResult: MatchPatternResult = {
				...(result as URLPatternResult),
				params: extractUnifiedParams(result as URLPatternResult, input), // Use original input for search params
			};
			return enhancedResult;
		}

		// URLPattern failed but our test passed - build result manually
		// This handles cases like order-independent search params
		return buildCustomResult(this, input);
	}

	/**
	 * Enhanced test with order-independent search parameter matching and trailing slash normalization
	 */
	override test(input: string | URL): boolean {
		const url = typeof input === "string" ? new URL(input) : input;

		// Create normalized URL for testing
		const normalizedUrl = normalizeTrailingSlash(url);

		// If there's no search pattern, test with normalized URL
		if (!this.search || this.search === "*") {
			return super.test(normalizedUrl);
		}

		// For search patterns, we need custom logic for order independence
		// First check if pathname matches with normalization
		const pathPatternInit =
			typeof this._originalInput === "string"
				? {pathname: this._originalInput}
				: {...this._originalInput, search: undefined};

		// Create normalized pattern for pathname testing
		const normalizedPattern = normalizePatternTrailingSlash(pathPatternInit);
		const pathPattern = new URLPattern(normalizedPattern);

		if (!pathPattern.test(normalizedUrl)) {
			return false; // Pathname doesn't match
		}

		// Now check search parameters with order independence
		return testSearchParameters(this.search, url.searchParams);
	}
}

/**
 * Parse string patterns with & syntax into URLPattern object format
 * Examples:
 *   '/api/posts/:id' -> { pathname: '/api/posts/:id' }
 *   '/api/posts/:id&format=:format' -> { pathname: '/api/posts/:id', search: 'format=:format' }
 *   '&q=:query&page=:page' -> { search: 'q=:query&page=:page' }
 *   'https://api.example.com/posts/:id' -> Full URL pattern string
 */
function parseStringPattern(pattern: string): string | URLPatternInit {
	// Check if it's a full URL (contains protocol)
	if (pattern.includes("://")) {
		// For full URLs, delegate to URLPattern but handle & syntax
		const ampIndex = pattern.indexOf("&");
		if (ampIndex === -1) {
			// No search params, just return the pattern as-is
			return pattern;
		}

		// Split URL and search params
		const urlPart = pattern.slice(0, ampIndex);
		const search = pattern.slice(ampIndex + 1);

		// Parse the URL to extract components
		try {
			const url = new URL(urlPart.replace(/:(\w+)/g, "placeholder")); // Replace params for parsing
			return {
				protocol: urlPart.split("://")[0],
				hostname: url.hostname,
				pathname: url.pathname.replace(/placeholder/g, ":$1"), // Restore params
				search,
			};
		} catch {
			// If URL parsing fails, return as-is
			return pattern;
		}
	}

	// Find first & to split pathname from search params
	const ampIndex = pattern.indexOf("&");

	if (ampIndex === -1) {
		// No search params, just pathname
		return {pathname: pattern};
	}

	if (ampIndex === 0) {
		// Starts with &, only search params
		return {search: pattern.slice(1)}; // Remove leading &
	}

	// Split pathname and search params
	const pathname = pattern.slice(0, ampIndex);
	const search = pattern.slice(ampIndex + 1);

	return {pathname, search};
}

/**
 * Extract unified params from URLPattern result and original URL
 * Combines pathname groups, search groups, and extra search params
 */
function extractUnifiedParams(
	result: URLPatternResult,
	url: string | URL,
): Record<string, string> {
	const params: Record<string, string> = {};

	// Add pathname parameters (filter out undefined values)
	if (result.pathname?.groups) {
		for (const [key, value] of Object.entries(result.pathname.groups)) {
			if (value !== undefined) {
				params[key] = value;
			}
		}
	}

	// Add search parameters - but we need to handle URLPattern's greedy capture bug
	if (result.search?.groups) {
		// URLPattern captures everything after the first param as part of that param's value
		// We need to parse the actual URL search params instead
		const actualUrl = typeof url === "string" ? new URL(url) : url;
		const searchParams = actualUrl.searchParams;

		// Get all actual search parameters
		for (const [key, value] of searchParams) {
			params[key] = value;
		}
	} else if (typeof url !== "string") {
		// No search pattern, but URL might have search params - capture them all
		const actualUrl = url instanceof URL ? url : new URL(url);
		for (const [key, value] of actualUrl.searchParams) {
			params[key] = value;
		}
	}

	return params;
}

/**
 * Normalize trailing slash in URL for consistent matching
 * Ensures consistent behavior regardless of trailing slash presence
 */
function normalizeTrailingSlash(url: URL): URL {
	const normalized = new URL(url.href);

	// Don't normalize root path
	if (normalized.pathname === "/") {
		return normalized;
	}

	// Remove trailing slash if present (except for root)
	if (normalized.pathname.endsWith("/")) {
		normalized.pathname = normalized.pathname.slice(0, -1);
	}

	return normalized;
}

/**
 * Normalize trailing slash in pattern for consistent matching
 */
function normalizePatternTrailingSlash(
	patternInit: URLPatternInit | string,
): URLPatternInit | string {
	if (typeof patternInit === "string") {
		// Handle string patterns
		if (patternInit === "/" || patternInit === "") {
			return patternInit; // Don't normalize root
		}

		// Remove trailing slash from string patterns
		return patternInit.endsWith("/") ? patternInit.slice(0, -1) : patternInit;
	}

	// Handle object patterns
	const normalized = {...patternInit};

	if (normalized.pathname && normalized.pathname !== "/") {
		// Remove trailing slash from pathname
		if (normalized.pathname.endsWith("/")) {
			normalized.pathname = normalized.pathname.slice(0, -1);
		}
	}

	return normalized;
}

/**
 * Build custom result when URLPattern fails but MatchPattern succeeds
 * This handles cases like order-independent search parameters
 */
function buildCustomResult(
	pattern: MatchPattern,
	input: string | URL,
): MatchPatternResult {
	const url = typeof input === "string" ? new URL(input) : input;

	// Create base result structure like URLPattern
	const result: MatchPatternResult = {
		inputs: [input],
		pathname: {input: url.pathname, groups: {}},
		search: {input: url.search, groups: {}},
		hash: {input: url.hash, groups: {}},
		protocol: {input: url.protocol, groups: {}},
		hostname: {input: url.hostname, groups: {}},
		port: {input: url.port, groups: {}},
		username: {input: url.username, groups: {}},
		password: {input: url.password, groups: {}},
		params: {},
	};

	// Extract pathname parameters if pattern has pathname
	if (pattern.pathname && pattern.pathname !== "*") {
		const pathPattern = new URLPattern({pathname: pattern.pathname});
		const pathResult = pathPattern.exec(url);
		if (pathResult?.pathname?.groups) {
			result.pathname.groups = pathResult.pathname.groups;
		}
	}

	// Extract search parameters manually (order-independent)
	if (pattern.search && pattern.search !== "*") {
		const searchParams = parseSearchPattern(pattern.search);
		const actualParams = url.searchParams;

		for (const [key, paramDef] of searchParams) {
			if (actualParams.has(key)) {
				if (paramDef.type === "named" && paramDef.name) {
					result.search.groups[paramDef.name] = actualParams.get(key)!;
				}
			}
		}
	}

	// Build unified params
	result.params = extractUnifiedParams(result, input);

	return result;
}

/**
 * Test search parameters with order independence
 */
function testSearchParameters(
	searchPattern: string,
	actualParams: URLSearchParams,
): boolean {
	// Parse the search pattern to extract required parameters
	const patternParams = parseSearchPattern(searchPattern);

	// Check that all required parameters are present
	for (const [key, paramPattern] of patternParams) {
		if (!actualParams.has(key)) {
			return false; // Required parameter missing
		}

		// If it's a named parameter (:param), any value is OK
		// If it's a literal value, check exact match
		if (paramPattern.type === "literal") {
			if (actualParams.get(key) !== paramPattern.value) {
				return false; // Literal value doesn't match
			}
		}
		// For named parameters (:param) and wildcards (*), any value matches
	}

	return true; // All required parameters present and valid
}

/**
 * Parse search pattern into parameter requirements
 */
function parseSearchPattern(pattern: string): Map<string, ParamDefinition> {
	const params = new Map<string, ParamDefinition>();

	// Split on & to get individual parameter patterns
	const parts = pattern.split("&");

	for (const part of parts) {
		const [key, value] = part.split("=");
		if (!key || !value) continue;

		if (value.startsWith(":")) {
			// Named parameter (:param or :param?)
			const isOptional = value.endsWith("?");
			params.set(key, {
				type: "named",
				name: value.slice(1, isOptional ? -1 : undefined),
				optional: isOptional,
			});
		} else if (value === "*") {
			// Wildcard parameter
			params.set(key, {type: "wildcard"});
		} else {
			// Literal value
			params.set(key, {type: "literal", value});
		}
	}

	return params;
}


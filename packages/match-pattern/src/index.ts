/**
 * High-performance URLPattern-compatible implementation for web routing with
 * enhanced search parameter handling.
 */

/**
 * Check if a protocol is valid per URL spec
 * Must start with ASCII letter, followed by ASCII letters, digits, +, -, or .
 */
function isValidProtocol(protocol: string): boolean {
	if (!protocol) return false;
	// Protocol must start with ASCII letter
	if (!/^[a-zA-Z]/.test(protocol)) return false;
	// Followed by ASCII letters, digits, +, -, or .
	return /^[a-zA-Z][a-zA-Z0-9+\-.]*$/.test(protocol);
}

/**
 * Check if a protocol is a "special" scheme per URL spec
 * Special schemes have specific pathname requirements (must start with /)
 */
function isSpecialScheme(protocol: string): boolean {
	const special = ["http", "https", "ws", "wss", "ftp", "file"];
	return special.includes(protocol.toLowerCase());
}

/**
 * Check if a protocol pattern can only match non-special schemes
 * Returns true if the pattern is definitely non-special (e.g., "javascript", "data", "(data|javascript)")
 * Returns false if it could match a special scheme (e.g., "https", "(https|javascript)", "*")
 */
function isDefinitelyNonSpecialScheme(
	protocolPattern: string | undefined,
): boolean {
	if (!protocolPattern) return false; // No protocol = could be special

	// Check for pattern syntax that could match special schemes
	if (protocolPattern.includes("*") || protocolPattern.includes("+")) {
		return false; // Wildcards could match anything
	}

	// Check for group patterns like (a|b|c)
	const groupMatch = protocolPattern.match(/^\(([^)]+)\)$/);
	if (groupMatch) {
		// Check if all alternatives are non-special
		const alternatives = groupMatch[1].split("|");
		return alternatives.every((alt) => !isSpecialScheme(alt.trim()));
	}

	// Check for named parameter patterns
	if (protocolPattern.includes(":")) {
		return false; // Named params could match anything
	}

	// Simple literal protocol
	return !isSpecialScheme(protocolPattern);
}

const DEFAULT_PORTS: Record<string, string> = {
	http: "80",
	https: "443",
	ws: "80",
	wss: "443",
	ftp: "21",
};
/**
 * Get the default port for a protocol, per URL spec
 */
function getDefaultPort(protocol: string): string | undefined {
	return DEFAULT_PORTS[protocol.toLowerCase()];
}

/**
 * Convert IDN (Internationalized Domain Name) to ASCII/Punycode form
 * e.g., "🚲.com" -> "xn--h78h.com", "münchen.de" -> "xn--mnchen-3ya.de"
 * Returns original hostname if conversion fails
 */
function toASCII(hostname: string): string {
	try {
		return new URL("http://" + hostname).hostname;
	} catch (err) {
		if (!(err instanceof TypeError)) throw err; // URL parse error
		return hostname;
	}
}

/**
 * Check if a regex pattern requires the ES2024 v-flag
 * The v-flag is needed for character class set operations:
 * - Set subtraction: [a-z--[aeiou]] (a-z minus vowels)
 * - Set intersection: [\d&&[0-4]] (digits AND 0-4)
 * - Nested character classes: [[a-z][A-Z]]
 */
function requiresVFlag(pattern: string): boolean {
	// Look for -- or && inside character classes
	// These are the v-flag set operations
	let inCharClass = 0;
	for (let i = 0; i < pattern.length; i++) {
		const char = pattern[i];
		if (char === "\\") {
			i++; // Skip escaped char
			continue;
		}
		if (char === "[") {
			inCharClass++;
		} else if (char === "]") {
			inCharClass = Math.max(0, inCharClass - 1);
		} else if (inCharClass > 0) {
			// Check for set operations
			if (char === "-" && pattern[i + 1] === "-") {
				return true; // Set subtraction --
			}
			if (char === "&" && pattern[i + 1] === "&") {
				return true; // Set intersection &&
			}
		}
	}
	return false;
}

/**
 * Validate regex group content per URLPattern spec
 * - Must contain only ASCII characters
 * - Must use valid escape sequences
 * Throws TypeError if invalid
 */
function validateRegexGroupContent(regexContent: string): void {
	// Check for non-ASCII characters
	for (const c of regexContent) {
		if (c.charCodeAt(0) > 127) {
			throw new TypeError(
				`Invalid pattern: regex groups cannot contain non-ASCII characters`,
			);
		}
	}

	// Valid escapes: \d, \D, \w, \W, \s, \S, \b, \B, \n, \r, \t, \f, \v, \0, \cX, \xHH, \uHHHH, \\, \/, \., etc.
	// Invalid escapes: \m, \a (not a valid escape), etc.
	const invalidEscape = regexContent.match(
		/\\([^dDwWsSnrtfv0cbBxu.\\[\](){}|^$*+?/=-])/,
	);
	if (invalidEscape) {
		throw new TypeError(
			`Invalid pattern: invalid escape sequence '\\${invalidEscape[1]}' in regex group`,
		);
	}
}

/**
 * Validate content inside IPv6 brackets [...]
 * Throws if content contains invalid characters for IPv6 addresses
 *
 * Rules:
 * - Named parameters (:name) ARE allowed
 * - Non-hex literal characters (like 'x', 'y' except a-f) are NOT allowed
 * - Non-ASCII characters are NOT allowed
 * - Escaped colons (\:) are allowed
 */
function validateIPv6BracketContent(content: string): void {
	let i = 0;
	while (i < content.length) {
		const char = content[i];

		// Handle escaped characters
		if (char === "\\") {
			i += 2;
			continue;
		}

		// Named parameters (:name) are allowed in IPv6 patterns
		if (char === ":") {
			const paramMatch = content
				.slice(i)
				.match(/^:(\p{ID_Start}\p{ID_Continue}*)([?+*])?/u);
			if (paramMatch) {
				i += paramMatch[0].length;
				continue;
			}
			// Plain colon (IPv6 separator) - allowed
			i++;
			continue;
		}

		// Check for non-ASCII
		if (char.charCodeAt(0) > 127) {
			throw new TypeError(
				`Invalid hostname pattern: non-ASCII character '${char}' in IPv6 brackets`,
			);
		}

		// Check for invalid hex characters
		// Valid: 0-9, a-f, A-F
		if (/[a-zA-Z]/.test(char) && !/[a-fA-F]/.test(char)) {
			throw new TypeError(
				`Invalid hostname pattern: invalid IPv6 character '${char}'`,
			);
		}

		i++;
	}
}

/**
 * Validate hostname pattern per URLPattern spec
 * Throws if hostname contains forbidden characters that aren't part of pattern syntax
 *
 * Per URLPattern spec:
 * - ERROR: space, %, \:, <, >, ?, @, [, ], ^, |
 * - OK (triggers URL parsing/normalization): #, /, \\, \n, \r, \t
 *
 * Pattern syntax chars are allowed: *, :name, {...}, (...)
 */
function validateHostnamePattern(hostname: string): void {
	// Characters that always cause an error (not URL component boundaries)
	// eslint-disable-next-line no-control-regex, no-useless-escape -- \x00 intentionally matches null bytes
	const alwaysForbidden = /[\x00 %<>?@\^|]/;

	// Walk through the pattern, tracking pattern syntax context
	let i = 0;
	while (i < hostname.length) {
		const char = hostname[i];

		// Skip escaped characters - \x escapes the next char
		if (char === "\\") {
			// Check if the escaped char itself is forbidden
			if (i + 1 < hostname.length) {
				const escaped = hostname[i + 1];
				// Escaped colon is forbidden in hostname (unlike pathname)
				if (escaped === ":") {
					throw new TypeError(
						`Invalid hostname pattern: escaped colon is not allowed`,
					);
				}
				// Escaped backslash is OK (\\)
			}
			i += 2;
			continue;
		}

		// Handle brace groups: {...}
		// Need to validate IPv6 content inside braces
		if (char === "{") {
			const closeIdx = hostname.indexOf("}", i);
			if (closeIdx !== -1) {
				const braceContent = hostname.slice(i + 1, closeIdx);
				// Check for IPv6 brackets inside the brace group
				const bracketMatch = braceContent.match(/\[([^\]]*)\]/);
				if (bracketMatch) {
					validateIPv6BracketContent(bracketMatch[1]);
				}
				i = closeIdx + 1;
				// Skip modifier after }
				if (hostname[i] === "?" || hostname[i] === "+" || hostname[i] === "*")
					i++;
				continue;
			}
		}

		if (char === "(") {
			let depth = 1;
			let j = i + 1;
			while (j < hostname.length && depth > 0) {
				if (hostname[j] === "\\") {
					j += 2;
					continue;
				}
				if (hostname[j] === "(") depth++;
				if (hostname[j] === ")") depth--;
				j++;
			}
			i = j;
			// Skip modifier after )
			if (hostname[i] === "?" || hostname[i] === "+" || hostname[i] === "*")
				i++;
			continue;
		}

		if (char === ":") {
			// Check if this is a named parameter :name
			// Unicode letters, numbers, underscore, and symbols (except +*?) are allowed per URLPattern spec
			const paramMatch = hostname
				.slice(i)
				.match(/^:(\p{ID_Continue}+)(\([^)]*\))?([?+*])?/u);
			if (paramMatch) {
				i += paramMatch[0].length;
				continue;
			}
			// Otherwise it's a literal colon which is forbidden
			throw new TypeError(
				`Invalid hostname pattern: unescaped colon outside of pattern syntax`,
			);
		}

		if (char === "*") {
			i++;
			// Skip modifier after *
			if (hostname[i] === "?" || hostname[i] === "+" || hostname[i] === "*")
				i++;
			continue;
		}

		if (char === "[") {
			// Could be IPv6 pattern [...]
			const closeIdx = hostname.indexOf("]", i);
			if (closeIdx !== -1) {
				// Validate IPv6 bracket content
				const ipv6Content = hostname.slice(i + 1, closeIdx);
				validateIPv6BracketContent(ipv6Content);
				i = closeIdx + 1;
				continue;
			}
			// Unmatched [ is forbidden
			throw new TypeError(`Invalid hostname pattern: unmatched '[' character`);
		}

		// Unmatched ] is also forbidden
		if (char === "]") {
			throw new TypeError(`Invalid hostname pattern: unmatched ']' character`);
		}

		// Check for forbidden characters
		if (alwaysForbidden.test(char)) {
			throw new TypeError(
				`Invalid hostname pattern: forbidden character '${char}'`,
			);
		}

		i++;
	}
}

/**
 * Normalize hostname pattern per URLPattern spec
 * - Strip \t, \n, \r (ASCII tab/newline/CR)
 * - Truncate at # or / (URL component boundaries)
 */
function normalizeHostnamePattern(hostname: string): string {
	// Strip ASCII tab, newline, carriage return
	hostname = hostname.replace(/[\t\n\r]/g, "");

	// Truncate at component delimiters (?, #, /)
	// These act as delimiters even when escaped (escape just prevents ? from being an error)
	// Need to find the first unescaped delimiter OR escaped ? (which still acts as delimiter)
	let truncateIdx = -1;
	for (let i = 0; i < hostname.length; i++) {
		const char = hostname[i];
		if (char === "\\") {
			// Check if escaping a ? - this still acts as delimiter
			if (i + 1 < hostname.length && hostname[i + 1] === "?") {
				truncateIdx = i;
				break;
			}
			// Skip the escaped character
			i++;
			continue;
		}
		// Unescaped # or / are delimiters
		if (char === "#" || char === "/") {
			truncateIdx = i;
			break;
		}
		// Unescaped ? would already be caught by validateHostnamePattern as an error
	}

	if (truncateIdx !== -1) {
		hostname = hostname.slice(0, truncateIdx);
	}

	return hostname;
}

/**
 * Canonicalize port value per URL spec
 * Strips ASCII tab/newline/CR, extracts leading digits
 * Returns canonicalized port or undefined if invalid
 * Note: Does not validate range for pattern matching purposes
 */
function canonicalizePort(
	port: string,
	throwOnInvalid: boolean = false,
): string | undefined {
	if (port === "") return ""; // Empty port is valid (default)

	// Strip ASCII tab, newline, and carriage return per URL spec
	const stripped = port.replace(/[\t\n\r]/g, "");

	// Extract leading digits (URL spec behavior)
	const match = stripped.match(/^(\d+)/);
	if (!match) return undefined; // No leading digits = invalid

	const numericPort = parseInt(match[1], 10);

	// Port must be in valid range 0-65535
	if (numericPort > 65535) {
		if (throwOnInvalid) {
			throw new TypeError(`Invalid port: ${port} (must be 0-65535)`);
		}
		return undefined;
	}

	return numericPort.toString();
}

/**
 * Validate port string for pattern compilation
 * More strict than canonicalizePort - rejects ports with trailing garbage
 */
function isValidPatternPort(port: string): boolean {
	if (port === "") return true;
	// Strip ASCII tab, newline, and carriage return
	const stripped = port.replace(/[\t\n\r]/g, "");
	// Port must be all digits for pattern (no trailing chars)
	return /^\d+$/.test(stripped);
}

/**
 * Percent-encode a pathname component per URL spec
 * URL pathnames allow more characters than encodeURIComponent
 * Only encodes characters that are truly forbidden in URL paths
 */
function encodePathname(pathname: string): string {
	// Split by / to preserve slashes
	return pathname
		.split("/")
		.map((segment) => {
			// Don't decode first - preserve existing percent-encoding
			// Just encode characters that aren't already allowed
			let result = "";
			for (const char of segment) {
				const code = char.charCodeAt(0);
				// Encode non-ASCII, control chars, space, # ? [ ] and other forbidden chars
				// Allow: alphanumeric, - . _ ~ ! $ & ' ( ) * + , ; = : @ %
				// Include % to preserve existing percent-encoding
				if (
					(code >= 0x41 && code <= 0x5a) || // A-Z
					(code >= 0x61 && code <= 0x7a) || // a-z
					(code >= 0x30 && code <= 0x39) || // 0-9
					"-._~!$&'()*+,;=:@%".includes(char)
				) {
					result += char;
				} else {
					// Percent-encode
					result += encodeURIComponent(char);
				}
			}
			return result;
		})
		.join("/");
}

/**
 * Percent-encode a search component (without leading ?)
 * Preserves = and & for query parameter parsing
 */
function encodeSearch(search: string): string {
	// Encode raw non-ASCII characters but preserve existing percent-encoding as-is
	let result = "";
	for (let i = 0; i < search.length; i++) {
		const char = search[i];
		const code = char.charCodeAt(0);

		if (char === "%") {
			// Check if this is valid percent-encoding
			if (i + 2 < search.length) {
				const hex = search.slice(i + 1, i + 3);
				if (/^[0-9a-fA-F]{2}$/.test(hex)) {
					// Keep percent-encoding as-is (preserve case)
					result += search.slice(i, i + 3);
					i += 2;
					continue;
				}
			}
			// Invalid percent-encoding, encode the %
			result += "%25";
		} else if (code >= 0x80) {
			// Non-ASCII - encode with uppercase hex
			if (code >= 0xd800 && code <= 0xdbff && i + 1 < search.length) {
				// Surrogate pair
				const nextCode = search.charCodeAt(i + 1);
				if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
					result += encodeURIComponent(search.slice(i, i + 2));
					i++;
					continue;
				}
			}
			result += encodeURIComponent(char);
		} else {
			// ASCII - keep as-is
			result += char;
		}
	}
	return result;
}

/**
 * Percent-encode a hash component
 */
function encodeHash(hash: string): string {
	// Decode first if already encoded, then re-encode for canonical form
	try {
		return encodeURIComponent(decodeURIComponent(hash));
	} catch (err) {
		// Only ignore "URI malformed" errors from invalid encoding, rethrow others
		if (
			!(err instanceof URIError) ||
			!String(err.message).includes("URI malformed")
		) {
			throw err;
		}
		// If decoding fails, just encode as-is
		return encodeURIComponent(hash);
	}
}

/**
 * Normalize pathname by resolving . and .. segments
 */
function normalizePathname(pathname: string): string {
	// Handle empty or just "/"
	if (!pathname || pathname === "/") {
		return "/";
	}

	// Track if pathname had leading and trailing slashes
	const hadLeadingSlash = pathname.startsWith("/");
	const hadTrailingSlash = pathname.endsWith("/") && pathname !== "/";

	// Split into segments (filter out empty strings except we'll handle trailing slash separately)
	const segments = pathname.split("/").filter((s, i, arr) => {
		// Keep all non-empty segments
		// For empty segments, only skip the first one (before leading /) and middle ones
		// We'll handle trailing slash separately
		return s !== "" || (i === arr.length - 1 && i > 0);
	});

	const normalized: string[] = [];

	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i];

		if (segment === ".") {
			// Skip "." segments
			continue;
		} else if (segment === "..") {
			// Go up one directory (remove last segment if exists)
			if (normalized.length > 0 && normalized[normalized.length - 1] !== "..") {
				normalized.pop();
			}
		} else if (segment === "" && i === segments.length - 1) {
			// This is a trailing empty segment (from trailing slash) - skip it
			// We'll add it back at the end if needed
			continue;
		} else {
			normalized.push(segment);
		}
	}

	// Reconstruct pathname, preserving leading slash only if original had it
	let result = normalized.join("/");
	if (hadLeadingSlash) {
		result = "/" + result;
	}

	// Restore trailing slash if it was present
	if (hadTrailingSlash && !result.endsWith("/")) {
		result += "/";
	}

	return result;
}

/**
 * Create a prototype-less record for params and groups. Keys can come from
 * the URL (e.g. "__proto__" or "constructor" in a query string), so they must
 * be plain own properties that can't shadow or pollute Object.prototype.
 */
function createRecord(): Record<string, string> {
	return Object.create(null);
}

/**
 * Result of pattern matching
 */
export interface MatchPatternResult {
	/**
	 * Unified pathname and search params (null-prototype object). Pathname
	 * params take precedence: a search param never overrides a name declared
	 * in the pathname pattern.
	 */
	params: Record<string, string>;
	pathname: {input: string; groups: Record<string, string>};
	search: {input: string; groups: Record<string, string>};
	protocol: {input: string; groups: Record<string, string>};
	hostname: {input: string; groups: Record<string, string>};
	port: {input: string; groups: Record<string, string>};
	username: {input: string; groups: Record<string, string>};
	password: {input: string; groups: Record<string, string>};
	hash: {input: string; groups: Record<string, string>};
	inputs: (string | URLPatternInit)[];
}

/**
 * Compiled pattern for fast matching
 */
export interface CompiledPattern {
	regex: RegExp;
	paramNames: string[];
	hasWildcard: boolean;
}

/**
 * Segment types for parsed patterns
 */
export type PatternSegment =
	| {type: "static"; value: string}
	| {type: "param"; name: string}
	| {type: "wildcard"};

/**
 * Result of parsing a simple pattern
 */
export interface ParsedPattern {
	segments: PatternSegment[];
	paramNames: string[];
	hasWildcard: boolean;
}

/**
 * Check if a pathname pattern is "simple" (can be handled by radix tree)
 * Simple patterns only have:
 * - Static segments: /api/users
 * - Basic named params: :id, :slug
 * - Trailing wildcard: /*
 *
 * Complex patterns (return false) have:
 * - Param constraints: :id(\d+)
 * - Param modifiers: :path+, :path*, :id?
 * - Regex groups: (\d+)
 * - Optional groups: {/prefix}?
 * - Escaped characters: \.
 */
export function isSimplePattern(pathname: string): boolean {
	// Quick check for complex pattern syntax
	if (pathname.includes("\\")) return false; // Escaped chars
	if (pathname.includes("{")) return false; // Optional groups
	if (pathname.includes("(")) return false; // Regex groups or constraints
	if (pathname.includes("+")) return false; // Repeat modifier
	if (pathname.includes("?")) return false; // Optional modifier

	// Check for wildcard - only allowed at end as /*
	const wildcardIndex = pathname.indexOf("*");
	if (wildcardIndex !== -1) {
		// Wildcard must be at end, preceded by /
		if (wildcardIndex !== pathname.length - 1) return false;
		if (pathname[wildcardIndex - 1] !== "/") return false;
	}

	// Check params don't have modifiers or constraints
	const paramMatches = pathname.matchAll(/:(\p{ID_Continue}+)/gu);
	for (const match of paramMatches) {
		const afterParam = pathname[match.index! + match[0].length];
		// If followed by ( or modifier, it's complex
		if (
			afterParam === "(" ||
			afterParam === "?" ||
			afterParam === "+" ||
			afterParam === "*"
		) {
			return false;
		}
	}

	return true;
}

/**
 * Parse a simple pathname pattern into segments for radix tree insertion
 * Returns null if the pattern is complex (use regex instead)
 *
 * Examples:
 * - "/api/users" -> [{ type: "static", value: "/api/users" }]
 * - "/users/:id" -> [{ type: "static", value: "/users/" }, { type: "param", name: "id" }]
 * - "/files/*" -> [{ type: "static", value: "/files/" }, { type: "wildcard" }]
 */
export function parseSimplePattern(pathname: string): ParsedPattern | null {
	if (!isSimplePattern(pathname)) {
		return null;
	}

	const segments: PatternSegment[] = [];
	const paramNames: string[] = [];
	let hasWildcard = false;
	let currentStatic = "";
	let i = 0;

	while (i < pathname.length) {
		const char = pathname[i];

		if (char === ":") {
			// Named parameter
			const match = pathname.slice(i).match(/^:(\p{ID_Continue}+)/u);
			if (match) {
				// Flush current static segment
				if (currentStatic) {
					segments.push({type: "static", value: currentStatic});
					currentStatic = "";
				}

				const name = match[1];
				paramNames.push(name);
				segments.push({type: "param", name});
				i += match[0].length;
				continue;
			}
		}

		if (char === "*") {
			// Wildcard (already validated to be at end)
			if (currentStatic) {
				segments.push({type: "static", value: currentStatic});
				currentStatic = "";
			}
			hasWildcard = true;
			segments.push({type: "wildcard"});
			break;
		}

		currentStatic += char;
		i++;
	}

	// Flush remaining static segment
	if (currentStatic) {
		segments.push({type: "static", value: currentStatic});
	}

	return {segments, paramNames, hasWildcard};
}

/**
 * Find an unescaped @ character in a pattern
 * Skips escaped \@ sequences
 * Returns index or -1 if not found
 */
function findUnescapedAt(pattern: string): number {
	for (let i = 0; i < pattern.length; i++) {
		if (pattern[i] === "\\" && i + 1 < pattern.length) {
			i++; // Skip escaped character
			continue;
		}
		if (pattern[i] === "@") {
			return i;
		}
	}
	return -1;
}

/**
 * Find an escaped colon (\:) in a pattern
 * Returns index of the backslash or -1 if not found
 */
function findEscapedColon(pattern: string): number {
	for (let i = 0; i < pattern.length - 1; i++) {
		if (pattern[i] === "\\" && pattern[i + 1] === ":") {
			return i;
		}
	}
	return -1;
}

/**
 * Find the index of a question mark that acts as search delimiter in a URL pattern
 *
 * In URLPattern syntax:
 * - `?` after pattern modifiers (*, +, ), :name) is a modifier meaning "optional"
 * - `?` inside groups (...), [...], {...} is part of the pattern, not a delimiter
 * - `?` in other positions (after hostname, after a complete path) is the search delimiter
 * - `\?` outside groups is always the search delimiter (escaped)
 *
 * Returns -1 if no search delimiter is found
 */
function findSearchDelimiter(pattern: string): {index: number; offset: number} {
	let parenDepth = 0;
	let bracketDepth = 0;
	let braceDepth = 0;

	for (let i = 0; i < pattern.length; i++) {
		const char = pattern[i];

		// Handle escapes
		if (char === "\\") {
			if (i + 1 < pattern.length && pattern[i + 1] === "?") {
				// Escaped ? - only a delimiter if outside all groups
				if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
					return {index: i, offset: 2}; // Skip both \ and ?
				}
			}
			i++; // Skip escaped char
			continue;
		}

		// Track group depth
		if (char === "(") parenDepth++;
		else if (char === ")") parenDepth--;
		else if (char === "[") bracketDepth++;
		else if (char === "]") bracketDepth--;
		else if (char === "{") braceDepth++;
		else if (char === "}") braceDepth--;

		// Look for ? only if outside all groups
		if (
			char === "?" &&
			parenDepth === 0 &&
			bracketDepth === 0 &&
			braceDepth === 0
		) {
			// Check what precedes the ?
			const prev = i > 0 ? pattern[i - 1] : "";

			// If preceded by modifier chars (* + ) }) it's a modifier
			if ("*+)}".includes(prev)) {
				continue; // This is a modifier, not a delimiter
			}

			// Check for named param like :name?
			// Look backwards to see if we're after a named param
			// Named params must start with a letter (not a digit - that's a port!)
			let j = i - 1;
			while (j >= 0 && /[\w]/.test(pattern[j])) {
				j--;
			}
			if (j >= 0 && pattern[j] === ":") {
				// Check if this is a named param (starts with letter) or port (starts with digit)
				const paramStart = j + 1;
				if (paramStart < i && /[a-zA-Z]/.test(pattern[paramStart])) {
					continue; // This is an optional modifier for a named param
				}
				// Otherwise it's a port like :8080, so ? is a delimiter
			}

			// This ? is a search delimiter
			return {index: i, offset: 1};
		}
	}

	return {index: -1, offset: 0};
}

/**
 * Find the start of pathname in a URL pattern string and handle special cases
 * Returns { index, truncateHostname, useWildcardPathname }
 * - Skips / characters inside pattern groups like (), []
 * - / inside {} triggers special handling: truncate brace content at /, use wildcard pathname
 */
function findPathnameStart(afterScheme: string): {
	index: number;
	truncateHostname?: number;
	useWildcardPathname?: boolean;
} {
	let parenDepth = 0;
	let bracketDepth = 0;
	let braceDepth = 0;
	let braceStart = -1;
	for (let i = 0; i < afterScheme.length; i++) {
		const char = afterScheme[i];
		if (char === "\\") {
			i++; // Skip escaped char
			continue;
		}
		if (char === "(") parenDepth++;
		else if (char === ")") parenDepth--;
		else if (char === "[") bracketDepth++;
		else if (char === "]") bracketDepth--;
		else if (char === "{") {
			braceDepth++;
			if (braceDepth === 1) braceStart = i;
		} else if (char === "}") {
			braceDepth--;
			if (braceDepth === 0) braceStart = -1;
		} else if (char === "/" && parenDepth === 0 && bracketDepth === 0) {
			if (braceDepth > 0 && braceStart !== -1) {
				// / inside a brace group - URLPattern keeps content before / in the brace
				// and uses wildcard pathname. We return the position of / for truncation.
				return {index: i, truncateHostname: i, useWildcardPathname: true};
			}
			return {index: i};
		}
	}
	return {index: -1};
}

/**
 * Validate URL pattern structure for common errors
 */
function validatePatternStructure(pattern: string): void {
	// Check for double braces {{ or }}
	if (pattern.includes("{{") || pattern.includes("}}")) {
		throw new TypeError("Invalid pattern: consecutive braces are not allowed");
	}

	// Check for nested braces {x{y}}
	let braceDepth = 0;
	for (let i = 0; i < pattern.length; i++) {
		const char = pattern[i];
		if (char === "\\") {
			i++; // Skip escaped char
			continue;
		}
		if (char === "{") {
			braceDepth++;
			if (braceDepth > 1) {
				throw new TypeError("Invalid pattern: nested braces are not allowed");
			}
		} else if (char === "}") {
			braceDepth--;
		}
	}

	// Check for groups spanning :// (scheme separator)
	// e.g., "{https://}" or "(https://)" are invalid
	const schemeIdx = pattern.indexOf("://");
	if (schemeIdx !== -1) {
		// Check if :// is inside any group
		let parenDepth = 0;
		let bracketDepth = 0;
		braceDepth = 0;
		for (let i = 0; i < schemeIdx; i++) {
			const char = pattern[i];
			if (char === "\\") {
				i++; // Skip escaped char
				continue;
			}
			if (char === "(") parenDepth++;
			else if (char === ")") parenDepth--;
			else if (char === "[") bracketDepth++;
			else if (char === "]") bracketDepth--;
			else if (char === "{") braceDepth++;
			else if (char === "}") braceDepth--;
		}
		// If we're inside any group when we hit ://, that's invalid
		if (parenDepth > 0 || bracketDepth > 0 || braceDepth > 0) {
			throw new TypeError(
				"Invalid pattern: groups cannot span the scheme separator",
			);
		}
	}
}

/**
 * Parse string pattern with & syntax
 */
function parseStringPattern(pattern: string): {
	protocol?: string;
	username?: string;
	password?: string;
	hostname?: string;
	port?: string;
	pathname?: string;
	search?: string;
	hash?: string;
} {
	// Validate pattern structure
	validatePatternStructure(pattern);

	// Handle search-only patterns starting with ?
	if (pattern.startsWith("?")) {
		// Extract hash if present
		const hashIndex = pattern.indexOf("#");
		if (hashIndex !== -1) {
			return {
				search: pattern.slice(1, hashIndex),
				hash: pattern.slice(hashIndex + 1),
			};
		}
		return {search: pattern.slice(1)};
	}

	// Handle hash-only patterns starting with #
	if (pattern.startsWith("#")) {
		return {hash: pattern.slice(1)};
	}

	// Check for non-hierarchical scheme (e.g., "data:", "javascript:", "mailto:")
	// These don't use :// so we need to detect them explicitly
	// Match: protocol + ":" + optional rest (no // after the :)
	const nonHierarchicalMatch = pattern.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*):/);
	if (
		nonHierarchicalMatch &&
		!pattern.startsWith(nonHierarchicalMatch[0] + "/")
	) {
		const protocol = nonHierarchicalMatch[1];
		// Skip if this looks like it has :// (hierarchical)
		if (pattern.startsWith(protocol + "://")) {
			// Fall through to hierarchical handling
		} else {
			const rest = pattern.slice(nonHierarchicalMatch[0].length);

			// URLPattern validation: pathname after non-hierarchical scheme cannot start with
			// an unescaped identifier (which would look like a named parameter :name)
			// e.g., "data:foobar" is invalid because "foobar" looks like it could be a param
			// but "data:*", "data:,foobar", "data:\foobar", "data:{foobar}" are valid
			if (rest.length > 0) {
				const firstChar = rest[0];
				// Check if it starts with an identifier (which would be ambiguous with param syntax)
				if (/\p{ID_Start}/u.test(firstChar)) {
					throw new TypeError(
						"Invalid URL pattern: non-hierarchical URL pathname cannot start with an identifier",
					);
				}
			}

			// Extract hash first
			const hashIndex = rest.indexOf("#");
			const hash = hashIndex === -1 ? undefined : rest.slice(hashIndex + 1);
			const beforeHash = hashIndex === -1 ? rest : rest.slice(0, hashIndex);

			// Extract search
			const searchDelim = findSearchDelimiter(beforeHash);
			const search =
				searchDelim.index === -1
					? undefined
					: beforeHash.slice(searchDelim.index + searchDelim.offset);
			const pathname =
				searchDelim.index === -1
					? beforeHash
					: beforeHash.slice(0, searchDelim.index);

			return {protocol, pathname, search, hash};
		}
	}

	// Check for escaped colon protocol separator (e.g., "https\:foo@example.com" or "data\:foobar")
	// The \: indicates this is a protocol separator
	const escapedColonMatch = pattern.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*)\\:/);
	if (escapedColonMatch) {
		const protocol = escapedColonMatch[1];
		const rest = pattern.slice(escapedColonMatch[0].length);

		// Only special schemes (http, https, ws, wss, ftp, file) have userinfo@hostname structure
		// Non-special schemes (data, javascript, etc.) treat everything after : as pathname
		const isSpecial = isSpecialScheme(protocol);

		// Check if this looks like a hierarchical URL (has @ for userinfo or hostname structure)
		// Pattern: userinfo@hostname/path or just hostname/path
		const atIdx = findUnescapedAt(rest);
		if (isSpecial && atIdx !== -1) {
			// Has userinfo - parse as full URL
			const userinfoStr = rest.slice(0, atIdx);
			const afterAt = rest.slice(atIdx + 1);

			// Parse userinfo (username\:password or just username)
			let username: string | undefined;
			let password: string | undefined;
			const colonIdx = findEscapedColon(userinfoStr);
			if (colonIdx !== -1) {
				username = userinfoStr.slice(0, colonIdx);
				password = userinfoStr.slice(colonIdx + 2); // Skip \:
			} else {
				username = userinfoStr;
			}

			// Parse hostname/port/pathname/search/hash from afterAt
			// Find first / which starts pathname
			const slashIdx = afterAt.indexOf("/");
			const hashIdx = afterAt.indexOf("#");
			const searchDelim = findSearchDelimiter(afterAt);

			// Find the end of hostname (first of /, ?, #)
			let hostEnd = afterAt.length;
			if (slashIdx !== -1 && slashIdx < hostEnd) hostEnd = slashIdx;
			if (searchDelim.index !== -1 && searchDelim.index < hostEnd)
				hostEnd = searchDelim.index;
			if (hashIdx !== -1 && hashIdx < hostEnd) hostEnd = hashIdx;

			const hostPart = afterAt.slice(0, hostEnd);

			// Parse hostname and port from hostPart
			let hostname: string;
			let port: string | undefined;
			const portColonIdx = hostPart.lastIndexOf(":");
			if (portColonIdx !== -1 && !hostPart.startsWith("[")) {
				// Has port (but not if it's IPv6 [::1])
				hostname = hostPart.slice(0, portColonIdx);
				port = hostPart.slice(portColonIdx + 1);
			} else {
				hostname = hostPart;
			}

			// Extract pathname, search, hash
			let pathname: string | undefined;
			let search: string | undefined;
			let hash: string | undefined;

			if (slashIdx !== -1) {
				const pathStart = slashIdx;
				let pathEnd = afterAt.length;
				if (searchDelim.index !== -1 && searchDelim.index > slashIdx)
					pathEnd = Math.min(pathEnd, searchDelim.index);
				if (hashIdx !== -1) pathEnd = Math.min(pathEnd, hashIdx);
				pathname = afterAt.slice(pathStart, pathEnd);
			}

			if (searchDelim.index !== -1) {
				let searchEnd = afterAt.length;
				if (hashIdx !== -1 && hashIdx > searchDelim.index) searchEnd = hashIdx;
				search = afterAt.slice(
					searchDelim.index + searchDelim.offset,
					searchEnd,
				);
			}

			if (hashIdx !== -1) {
				hash = afterAt.slice(hashIdx + 1);
			}

			return {
				protocol,
				username,
				password,
				hostname,
				port,
				pathname,
				search,
				hash,
			};
		}

		// No @, treat as non-hierarchical (like data:foobar)
		const hashIndex = rest.indexOf("#");
		const hash = hashIndex === -1 ? undefined : rest.slice(hashIndex + 1);
		const beforeHash = hashIndex === -1 ? rest : rest.slice(0, hashIndex);

		// Extract search
		const searchDelim = findSearchDelimiter(beforeHash);
		const search =
			searchDelim.index === -1
				? undefined
				: beforeHash.slice(searchDelim.index + searchDelim.offset);
		const pathname =
			searchDelim.index === -1
				? beforeHash
				: beforeHash.slice(0, searchDelim.index);

		return {protocol, pathname, search, hash};
	}

	// Check if it's a full URL with :// (including protocol patterns like http{s}?://)
	// Match protocols that may have pattern syntax like {s}? before ://
	const protocolMatch = pattern.match(
		/^([a-zA-Z][a-zA-Z0-9+\-.]*(?:\{[^}]*\}\??)?):/,
	);
	if (protocolMatch && pattern.includes("://")) {
		// Extract hash first (after #)
		const hashIndex = pattern.indexOf("#");
		const hash = hashIndex === -1 ? undefined : pattern.slice(hashIndex + 1);
		const beforeHash = hashIndex === -1 ? pattern : pattern.slice(0, hashIndex);

		// Extract search/query
		// Look for ? or \? that marks the search delimiter
		// Also check for & which is our custom search param syntax
		const searchDelim = findSearchDelimiter(beforeHash);
		const ampIndex = beforeHash.indexOf("&");

		// Use ? or \? if found, otherwise &
		let queryIndex = -1;
		let searchOffset = 0;
		if (
			searchDelim.index !== -1 &&
			(ampIndex === -1 || searchDelim.index < ampIndex)
		) {
			queryIndex = searchDelim.index;
			searchOffset = searchDelim.offset;
		} else if (ampIndex !== -1) {
			queryIndex = ampIndex;
			searchOffset = 1; // Skip just &
		}

		const search =
			queryIndex === -1
				? undefined
				: beforeHash.slice(queryIndex + searchOffset);
		const urlPart =
			queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);

		// Find where :// is to split protocol from rest
		const schemeEndIdx = urlPart.indexOf("://");
		const protocol = urlPart.slice(0, schemeEndIdx);
		let afterScheme = urlPart.slice(schemeEndIdx + 3);

		// Extract username and password (userinfo before @)
		// Look for @ but not inside [...] (IPv6), {...} (brace groups), or (...) (regex groups)
		let username: string | undefined;
		let password: string | undefined;
		let atIndex = -1;
		let bracketDepth = 0;
		let braceDepth = 0;
		let parenDepth = 0;
		for (let i = 0; i < afterScheme.length; i++) {
			const char = afterScheme[i];
			if (char === "\\") {
				i++; // Skip escaped char
				continue;
			}
			if (char === "[") bracketDepth++;
			else if (char === "]") bracketDepth--;
			else if (char === "{") braceDepth++;
			else if (char === "}") braceDepth--;
			else if (char === "(") parenDepth++;
			else if (char === ")") parenDepth--;
			else if (
				char === "@" &&
				bracketDepth === 0 &&
				braceDepth === 0 &&
				parenDepth === 0
			) {
				atIndex = i;
				break;
			} else if (
				char === "/" &&
				bracketDepth === 0 &&
				braceDepth === 0 &&
				parenDepth === 0
			) {
				// Reached pathname without finding @
				break;
			}
		}

		if (atIndex !== -1) {
			const userinfo = afterScheme.slice(0, atIndex);
			afterScheme = afterScheme.slice(atIndex + 1);

			// Split userinfo into username:password
			// In URLPattern, a colon is the separator UNLESS it starts a named parameter
			// An escaped colon (\:) is always a separator (escaping prevents param interpretation)
			// An unescaped colon followed by a valid identifier is a parameter, not separator
			let colonIndex = -1;
			let braceDepth = 0;
			for (let i = 0; i < userinfo.length; i++) {
				const char = userinfo[i];
				if (char === "\\") {
					// Check if this is an escaped colon
					if (i + 1 < userinfo.length && userinfo[i + 1] === ":") {
						// Escaped colon is a separator (the escape prevents parameter interpretation)
						colonIndex = i + 1;
						break;
					}
					// Skip the escaped character
					i++;
					continue;
				}
				if (char === "{") braceDepth++;
				else if (char === "}") braceDepth--;
				else if (char === ":" && braceDepth === 0) {
					// Check if this colon starts a named parameter
					const afterColon = userinfo.slice(i + 1);
					const paramMatch = afterColon.match(
						/^(\p{ID_Start}\p{ID_Continue}*)/u,
					);
					if (paramMatch) {
						// This is a named parameter, not a separator - skip it
						i += 1 + paramMatch[1].length;
						// Check for modifier after the parameter name
						if (i < userinfo.length && "?+*".includes(userinfo[i])) {
							i++;
						}
						i--; // Will be incremented by the loop
						continue;
					}
					// Not a parameter, this is the separator
					colonIndex = i;
					break;
				}
			}

			if (colonIndex !== -1) {
				username = userinfo.slice(0, colonIndex);
				// If the username ends with a backslash (from \: separator), remove it
				if (username.endsWith("\\")) {
					username = username.slice(0, -1);
				}
				password = userinfo.slice(colonIndex + 1);
			} else {
				username = userinfo;
			}
		}

		// Extract pathname (starts with first / after ://)
		// Must skip / inside pattern groups like (), []
		// / inside {} triggers special handling (truncate hostname, use wildcard pathname)
		const pathnameResult = findPathnameStart(afterScheme);
		let pathname: string;
		let hostPart: string;

		if (
			pathnameResult.useWildcardPathname &&
			pathnameResult.truncateHostname !== undefined
		) {
			// Special case: / inside brace group
			// Truncate hostname at the /, close the brace implicitly, use wildcard pathname
			hostPart = afterScheme.slice(0, pathnameResult.truncateHostname);
			// Find and close unclosed brace by removing content after the last {
			const lastBrace = hostPart.lastIndexOf("{");
			if (lastBrace !== -1) {
				// Keep content inside brace up to truncation point, then close it
				// e.g., "{.com/" -> ".com" (remove { and everything gets the content)
				const beforeBrace = hostPart.slice(0, lastBrace);
				const braceContent = hostPart.slice(lastBrace + 1);
				hostPart = beforeBrace + braceContent;
			}
			pathname = "*";
		} else if (pathnameResult.index === -1) {
			pathname = "/";
			hostPart = afterScheme;
		} else {
			pathname = afterScheme.slice(pathnameResult.index);
			hostPart = afterScheme.slice(0, pathnameResult.index);
		}

		// Extract port - look for :digits at the end, but be careful with pattern syntax
		// Port patterns can be :8080 or :(80|443) or :80{80}?
		const portMatch = hostPart.match(/:(\d+|\([^)]+\)|\d*\{[^}]+\}\??)$/);
		// When parsing a URL string, port is explicitly "" if not specified (not undefined)
		// This means "port must be empty or default", as opposed to undefined which means "any port"
		const port = portMatch ? portMatch[1] : "";

		// Extract hostname (without port)
		const hostname = portMatch
			? hostPart.slice(0, -portMatch[0].length)
			: hostPart;

		return {
			protocol,
			username,
			password,
			hostname,
			port,
			pathname,
			search,
			hash,
		};
	}

	// Handle pathname-only patterns that may have search/hash
	// e.g., "/foo?bar#baz" or "/foo#baz"
	if (pattern.startsWith("/")) {
		// Extract hash first
		const hashIndex = pattern.indexOf("#");
		const hash = hashIndex === -1 ? undefined : pattern.slice(hashIndex + 1);
		const beforeHash = hashIndex === -1 ? pattern : pattern.slice(0, hashIndex);

		// Extract search - use findSearchDelimiter or & syntax
		const searchDelim = findSearchDelimiter(beforeHash);
		const ampIndex = beforeHash.indexOf("&");

		let queryIndex = -1;
		let searchOffset = 0;
		if (
			searchDelim.index !== -1 &&
			(ampIndex === -1 || searchDelim.index < ampIndex)
		) {
			queryIndex = searchDelim.index;
			searchOffset = searchDelim.offset;
		} else if (ampIndex !== -1) {
			queryIndex = ampIndex;
			searchOffset = 1;
		}

		const search =
			queryIndex === -1
				? undefined
				: beforeHash.slice(queryIndex + searchOffset);
		const pathname =
			queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);

		return {pathname, search, hash};
	}

	// Not a URL - check for search params (legacy & syntax)
	const ampIndex = pattern.indexOf("&");

	if (ampIndex === -1) {
		return {pathname: pattern};
	}

	if (ampIndex === 0) {
		return {search: pattern.slice(1)};
	}

	return {
		pathname: pattern.slice(0, ampIndex),
		search: pattern.slice(ampIndex + 1),
	};
}

// ============================================================================
// Linear-time matching
// ============================================================================
//
// Patterns compile to JavaScript regexes, and the backtracking engines in V8
// and JavaScriptCore take polynomial time when several unbounded quantifiers
// compete for the same characters: "/*/*/*/end" compiles to
// ^\/(.*)\/(.*)\/(.*)\/end$ and "/:a-:b-:c" to ^\/([^/]+?)-([^/]+?)-([^/]+?)$,
// and a long non-matching path makes them try every way of splitting it.
//
// Regexes at risk (see needsLinearMatching) are created as LinearRegExp,
// which runs the same regex on a Pike VM (a breadth-first NFA simulation)
// instead. It takes O(input × pattern) time and yields exactly the captures
// backtracking would: threads are kept in priority order (greedy/lazy, left
// alternative first), and JavaScript's quantifier rules are replicated
// (captures inside a quantified atom reset on each iteration, and an
// iteration that matches the empty string fails once the minimum count is
// reached). Regexes using syntax outside the supported subset (lookarounds,
// backreferences, {n,m}, the u/v flags, ...) keep using the native engine.

/** Character set: flat [lo, hi, lo, hi, ...] code unit ranges */
interface LinearCharSet {
	ranges: number[];
	negate: boolean;
	/** Canonicalized members, for case-insensitive regexes */
	folded?: Set<number>;
}

type LinearNode =
	| {type: "char"; set: LinearCharSet}
	| {type: "seq"; items: LinearNode[]}
	| {type: "alt"; alts: LinearNode[]}
	| {type: "group"; index: number; body: LinearNode}
	| {
			type: "repeat";
			body: LinearNode;
			min: number;
			max: number;
			greedy: boolean;
			/** Capture groups inside body, as [first, last] group indices */
			groups: [number, number];
	  }
	| {type: "start"}
	| {type: "end"};

const OP_CHAR = 0;
const OP_SPLIT = 1; // Try x, then y
const OP_JMP = 2;
const OP_SAVE = 3; // slots[a] = position
const OP_RESET = 4; // slots[a..b] = -1
const OP_CHECK = 5; // Fail if slots[a] === position (empty iteration)
const OP_START = 6;
const OP_END = 7;
const OP_MATCH = 8;

interface LinearInst {
	op: number;
	a: number;
	b: number;
	set?: LinearCharSet;
}

interface LinearProgram {
	insts: LinearInst[];
	groupCount: number;
	slotCount: number;
	ignoreCase: boolean;
}

/** Thrown while parsing a regex that the linear engine doesn't support */
const UNSUPPORTED = Symbol("unsupported");

const DOT_RANGES = [0x0a, 0x0a, 0x0d, 0x0d, 0x2028, 0x2029];
const DIGIT_RANGES = [0x30, 0x39];
const WORD_RANGES = [0x30, 0x39, 0x41, 0x5a, 0x5f, 0x5f, 0x61, 0x7a];

/**
 * Canonicalize a code unit for case-insensitive matching without the u flag
 * (ECMAScript Canonicalize with rer.[[IgnoreCase]] and no Unicode)
 */
function canonicalize(code: number): number {
	const upper = String.fromCharCode(code).toUpperCase();
	if (upper.length !== 1) return code;
	const upperCode = upper.charCodeAt(0);
	if (code >= 128 && upperCode < 128) return code;
	return upperCode;
}

function linearCharSetHas(
	set: LinearCharSet,
	code: number,
	canonical: number,
): boolean {
	let found = false;
	if (set.folded) {
		found = set.folded.has(canonical);
	} else {
		const ranges = set.ranges;
		for (let i = 0; i < ranges.length; i += 2) {
			if (code >= ranges[i] && code <= ranges[i + 1]) {
				found = true;
				break;
			}
		}
	}
	return found !== set.negate;
}

/**
 * Parse a regex source into a LinearNode tree
 * Throws UNSUPPORTED for syntax outside the supported subset
 */
class LinearParser {
	source: string;
	pos: number;
	groupCount: number;

	constructor(source: string) {
		this.source = source;
		this.pos = 0;
		this.groupCount = 0;
	}

	parse(): LinearNode {
		const node = this.parseAlternation();
		if (this.pos !== this.source.length) throw UNSUPPORTED;
		return node;
	}

	parseAlternation(): LinearNode {
		const alts = [this.parseSequence()];
		while (this.source[this.pos] === "|") {
			this.pos++;
			alts.push(this.parseSequence());
		}
		return alts.length === 1 ? alts[0] : {type: "alt", alts};
	}

	parseSequence(): LinearNode {
		const items: LinearNode[] = [];
		while (this.pos < this.source.length) {
			const char = this.source[this.pos];
			if (char === "|" || char === ")") break;

			const firstGroup = this.groupCount + 1;
			const atom = this.parseAtom();
			const quantifier = this.source[this.pos];
			if (quantifier !== "*" && quantifier !== "+" && quantifier !== "?") {
				if (quantifier === "{") throw UNSUPPORTED;
				items.push(atom);
				continue;
			}
			if (atom.type === "start" || atom.type === "end") throw UNSUPPORTED;
			this.pos++;
			const greedy = this.source[this.pos] !== "?";
			if (!greedy) this.pos++;
			const max = quantifier === "?" ? 1 : Infinity;
			items.push({
				type: "repeat",
				body: atom,
				min: quantifier === "+" ? 1 : 0,
				max,
				greedy,
				groups: [firstGroup, this.groupCount],
			});
		}
		return items.length === 1 ? items[0] : {type: "seq", items};
	}

	parseAtom(): LinearNode {
		const source = this.source;
		const char = source[this.pos];
		switch (char) {
			case "^":
				this.pos++;
				return {type: "start"};
			case "$":
				this.pos++;
				return {type: "end"};
			case ".":
				this.pos++;
				return {type: "char", set: {ranges: DOT_RANGES, negate: true}};
			case "(": {
				let index = -1;
				if (source.startsWith("(?:", this.pos)) {
					this.pos += 3;
				} else if (source[this.pos + 1] === "?") {
					throw UNSUPPORTED; // Lookarounds and named groups
				} else {
					this.pos++;
					index = ++this.groupCount;
				}
				const body = this.parseAlternation();
				if (source[this.pos] !== ")") throw UNSUPPORTED;
				this.pos++;
				return {type: "group", index, body};
			}
			case "[":
				return {type: "char", set: this.parseClass()};
			case "\\": {
				const set = this.parseEscape();
				if (typeof set === "number") {
					return {type: "char", set: {ranges: [set, set], negate: false}};
				}
				return {type: "char", set};
			}
			case "*":
			case "+":
			case "?":
			case "{":
			case "}":
				throw UNSUPPORTED;
			default: {
				const code = source.charCodeAt(this.pos++);
				return {type: "char", set: {ranges: [code, code], negate: false}};
			}
		}
	}

	/**
	 * Parse an escape at pos (which points at the backslash)
	 * Returns a code unit for literal escapes, or a set for class escapes
	 */
	parseEscape(): number | LinearCharSet {
		const next = this.source[this.pos + 1];
		if (next === undefined) throw UNSUPPORTED;
		this.pos += 2;
		switch (next) {
			case "d":
				return {ranges: DIGIT_RANGES, negate: false};
			case "D":
				return {ranges: DIGIT_RANGES, negate: true};
			case "w":
				return {ranges: WORD_RANGES, negate: false};
			case "W":
				return {ranges: WORD_RANGES, negate: true};
		}
		// Identity escapes of syntax characters; anything alphanumeric (\b, \1,
		// \u, \s, ...) has a special meaning that isn't supported
		if (/[A-Za-z0-9]/.test(next)) throw UNSUPPORTED;
		return next.charCodeAt(0);
	}

	parseClass(): LinearCharSet {
		const source = this.source;
		this.pos++; // Skip [
		let negate = false;
		if (source[this.pos] === "^") {
			negate = true;
			this.pos++;
		}
		const ranges: number[] = [];
		while (source[this.pos] !== "]") {
			if (this.pos >= source.length) throw UNSUPPORTED;
			const lo = this.parseClassAtom();
			if (
				source[this.pos] === "-" &&
				source[this.pos + 1] !== "]" &&
				this.pos + 1 < source.length
			) {
				this.pos++;
				const hi = this.parseClassAtom();
				if (typeof lo !== "number" || typeof hi !== "number" || lo > hi) {
					throw UNSUPPORTED;
				}
				ranges.push(lo, hi);
			} else if (typeof lo === "number") {
				ranges.push(lo, lo);
			} else {
				// Class escapes inside a class; negated ones can't be flattened
				if (lo.negate) throw UNSUPPORTED;
				ranges.push(...lo.ranges);
			}
		}
		this.pos++; // Skip ]
		return {ranges, negate};
	}

	parseClassAtom(): number | LinearCharSet {
		if (this.source[this.pos] === "\\") return this.parseEscape();
		return this.source.charCodeAt(this.pos++);
	}
}

/**
 * Compile a LinearNode tree into Pike VM instructions
 */
function emitLinear(
	node: LinearNode,
	insts: LinearInst[],
	nextSlot: {value: number},
): void {
	const emit = (op: number, a = 0, b = 0, set?: LinearCharSet) => {
		insts.push({op, a, b, set});
		return insts.length - 1;
	};

	switch (node.type) {
		case "char":
			emit(OP_CHAR, 0, 0, node.set);
			break;
		case "start":
			emit(OP_START);
			break;
		case "end":
			emit(OP_END);
			break;
		case "seq":
			for (const item of node.items) emitLinear(item, insts, nextSlot);
			break;
		case "alt": {
			const jumps: number[] = [];
			for (let i = 0; i < node.alts.length; i++) {
				if (i < node.alts.length - 1) {
					const split = emit(OP_SPLIT);
					insts[split].a = insts.length;
					emitLinear(node.alts[i], insts, nextSlot);
					jumps.push(emit(OP_JMP));
					insts[split].b = insts.length;
				} else {
					emitLinear(node.alts[i], insts, nextSlot);
				}
			}
			for (const jump of jumps) insts[jump].a = insts.length;
			break;
		}
		case "group":
			if (node.index >= 0) emit(OP_SAVE, node.index * 2);
			emitLinear(node.body, insts, nextSlot);
			if (node.index >= 0) emit(OP_SAVE, node.index * 2 + 1);
			break;
		case "repeat": {
			const [firstGroup, lastGroup] = node.groups;
			// Captures inside the atom are cleared at the start of each iteration
			const emitBody = () => {
				if (firstGroup <= lastGroup) {
					emit(OP_RESET, firstGroup * 2, lastGroup * 2 + 1);
				}
				emitLinear(node.body, insts, nextSlot);
			};
			// x+ is x followed by x*
			if (node.min === 1) emitBody();

			// Optional iteration: record the start position so an iteration that
			// consumes nothing can be rejected, as JavaScript does
			const slot = nextSlot.value++;
			const loop = emit(OP_SPLIT);
			const bodyStart = insts.length;
			emit(OP_SAVE, slot);
			emitBody();
			emit(OP_CHECK, slot);
			if (node.max === Infinity) emit(OP_JMP, loop);
			const exit = insts.length;
			insts[loop].a = node.greedy ? bodyStart : exit;
			insts[loop].b = node.greedy ? exit : bodyStart;
			break;
		}
	}
}

/**
 * Members of a set (canonicalized when ignoring case), or null if too large
 */
function linearCharSetMembers(
	set: LinearCharSet,
	ignoreCase: boolean,
): Set<number> | null {
	const members = new Set<number>();
	const ranges = set.ranges;
	for (let i = 0; i < ranges.length; i += 2) {
		if (ranges[i + 1] - ranges[i] > 1024) return null;
		for (let code = ranges[i]; code <= ranges[i + 1]; code++) {
			members.add(ignoreCase ? canonicalize(code) : code);
		}
	}
	return members;
}

/**
 * Conservatively check whether two character sets can match the same character
 */
function linearCharSetsOverlap(
	a: LinearCharSet,
	b: LinearCharSet,
	ignoreCase: boolean,
): boolean {
	if (a.negate && b.negate) return true;
	const membersA = linearCharSetMembers(a, ignoreCase);
	const membersB = linearCharSetMembers(b, ignoreCase);
	if (!membersA || !membersB) return true;
	if (a.negate) return [...membersB].some((code) => !membersA.has(code));
	if (b.negate) return [...membersA].some((code) => !membersB.has(code));
	return [...membersA].some((code) => membersB.has(code));
}

/**
 * First characters a node can match, and whether it can match empty
 */
function linearFirst(node: LinearNode): {
	sets: LinearCharSet[];
	nullable: boolean;
} {
	switch (node.type) {
		case "char":
			return {sets: [node.set], nullable: false};
		case "start":
		case "end":
			return {sets: [], nullable: true};
		case "group":
			return linearFirst(node.body);
		case "repeat": {
			const first = linearFirst(node.body);
			return {sets: first.sets, nullable: first.nullable || node.min === 0};
		}
		case "alt": {
			const sets: LinearCharSet[] = [];
			let nullable = false;
			for (const alt of node.alts) {
				const first = linearFirst(alt);
				sets.push(...first.sets);
				nullable ||= first.nullable;
			}
			return {sets, nullable};
		}
		case "seq": {
			const sets: LinearCharSet[] = [];
			for (const item of node.items) {
				const first = linearFirst(item);
				sets.push(...first.sets);
				if (!first.nullable) return {sets, nullable: false};
			}
			return {sets, nullable: true};
		}
	}
}

/**
 * Decide whether a regex can backtrack super-linearly, by looking for choice
 * points: a quantifier is ambiguous when its atom can start with a character
 * that could also follow it, and an alternation when two alternatives can
 * start with the same character. Backtracking stays linear when no unbounded
 * quantifier follows an ambiguous one (e.g. "/*" or "/files/:path+/edit"),
 * and no unbounded quantifier contains a choice point. Both engines give the
 * same results, so a false positive only costs speed.
 */
function needsLinearMatching(root: LinearNode, ignoreCase: boolean): boolean {
	let needed = false;
	let choicePoints = 0;
	let afterAmbiguous = false;

	const overlaps = (a: LinearCharSet[], b: LinearCharSet[]) =>
		a.some((x) => b.some((y) => linearCharSetsOverlap(x, y, ignoreCase)));

	// follow: the sets of characters that can come right after node
	const visit = (node: LinearNode, follow: LinearCharSet[]): void => {
		switch (node.type) {
			case "group":
				visit(node.body, follow);
				break;
			case "seq": {
				// Compute each item's follow set right to left, then visit in order
				const follows: LinearCharSet[][] = [];
				let next = follow;
				for (let i = node.items.length - 1; i >= 0; i--) {
					follows[i] = next;
					const first = linearFirst(node.items[i]);
					next = first.nullable ? [...first.sets, ...next] : first.sets;
				}
				node.items.forEach((item, i) => visit(item, follows[i]));
				break;
			}
			case "alt": {
				// An alternative that can match empty also starts with what follows
				const firsts = node.alts.map((alt) => linearFirst(alt));
				const starts = firsts.map((first) =>
					first.nullable ? [...first.sets, ...follow] : first.sets,
				);
				for (let i = 0; i < firsts.length; i++) {
					for (let j = i + 1; j < firsts.length; j++) {
						if (
							(firsts[i].nullable && firsts[j].nullable) ||
							overlaps(starts[i], starts[j])
						) {
							choicePoints++;
						}
					}
				}
				for (const alt of node.alts) visit(alt, follow);
				break;
			}
			case "repeat": {
				const unbounded = node.max === Infinity;
				if (unbounded && afterAmbiguous) needed = true;
				const first = linearFirst(node.body);
				const before = choicePoints;
				visit(node.body, unbounded ? [...first.sets, ...follow] : follow);
				if (unbounded && choicePoints > before) needed = true;
				if (overlaps(first.sets, follow)) {
					choicePoints++;
					if (unbounded) afterAmbiguous = true;
				}
				break;
			}
		}
	};

	visit(root, []);
	return needed;
}

/**
 * Build a Pike VM program for a regex, or return null if the regex should
 * keep using the native engine (unsupported syntax, or no risk of
 * super-linear backtracking)
 */
function compileLinearProgram(
	source: string,
	flags: string,
): LinearProgram | null {
	if (flags !== "" && flags !== "i") return null;
	const ignoreCase = flags === "i";

	let root: LinearNode;
	const parser = new LinearParser(source);
	try {
		root = parser.parse();
	} catch (err) {
		if (err !== UNSUPPORTED) throw err;
		return null;
	}
	// Only anchored regexes are supported: matching is attempted at index 0
	if (root.type !== "seq" || root.items[0].type !== "start") return null;
	if (!needsLinearMatching(root, ignoreCase)) return null;

	const groupCount = parser.groupCount;
	const insts: LinearInst[] = [];
	const nextSlot = {value: (groupCount + 1) * 2};
	insts.push({op: OP_SAVE, a: 0, b: 0});
	emitLinear(root, insts, nextSlot);
	insts.push({op: OP_SAVE, a: 1, b: 0});
	insts.push({op: OP_MATCH, a: 0, b: 0});

	if (ignoreCase) {
		// Case-insensitive sets compare canonicalized code units, so enumerate
		// each set's members; bail out on sets too large to enumerate
		for (const inst of insts) {
			if (!inst.set) continue;
			const folded = linearCharSetMembers(inst.set, true);
			if (!folded) return null;
			inst.set = {...inst.set, folded};
		}
	}

	return {insts, groupCount, slotCount: nextSlot.value, ignoreCase};
}

/**
 * Run a Pike VM program against an input
 * Returns capture slots (start/end pairs, -1 when unset) or null
 */
function runLinearProgram(
	program: LinearProgram,
	input: string,
): number[] | null {
	const {insts, slotCount, ignoreCase} = program;
	const length = input.length;
	// Instruction index -> generation it was last queued in, for dedup
	const queued = new Int32Array(insts.length).fill(-1);
	let generation = 0;
	let current: {pc: number; slots: number[]}[] = [];
	let next: {pc: number; slots: number[]}[] = [];
	let matched: number[] | null = null;

	// Follow non-consuming instructions, queueing CHAR/MATCH threads in
	// priority order. A thread reaching an instruction already queued this
	// generation is dropped: the earlier thread has priority and the same
	// future, since everything after a CHAR consumes input first.
	const add = (
		list: {pc: number; slots: number[]}[],
		pc: number,
		slots: number[],
		pos: number,
	): void => {
		const inst = insts[pc];
		switch (inst.op) {
			case OP_JMP:
				add(list, inst.a, slots, pos);
				return;
			case OP_SPLIT:
				add(list, inst.a, slots, pos);
				add(list, inst.b, slots, pos);
				return;
			case OP_SAVE: {
				const copy = slots.slice();
				copy[inst.a] = pos;
				add(list, pc + 1, copy, pos);
				return;
			}
			case OP_RESET: {
				const copy = slots.slice();
				copy.fill(-1, inst.a, inst.b + 1);
				add(list, pc + 1, copy, pos);
				return;
			}
			case OP_CHECK:
				if (slots[inst.a] !== pos) add(list, pc + 1, slots, pos);
				return;
			case OP_START:
				if (pos === 0) add(list, pc + 1, slots, pos);
				return;
			case OP_END:
				if (pos === length) add(list, pc + 1, slots, pos);
				return;
			default:
				if (queued[pc] === generation) return;
				queued[pc] = generation;
				list.push({pc, slots});
		}
	};

	add(current, 0, new Array(slotCount).fill(-1), 0);
	for (let pos = 0; current.length > 0; pos++) {
		generation++;
		const code = pos < length ? input.charCodeAt(pos) : -1;
		const canonical = ignoreCase && code >= 0 ? canonicalize(code) : code;
		for (const thread of current) {
			const inst = insts[thread.pc];
			if (inst.op === OP_MATCH) {
				// Lower-priority threads can't override this match
				matched = thread.slots;
				break;
			}
			if (code >= 0 && linearCharSetHas(inst.set!, code, canonical)) {
				add(next, thread.pc + 1, thread.slots, pos + 1);
			}
		}
		[current, next] = [next, current];
		next.length = 0;
	}

	return matched;
}

/**
 * A RegExp that matches with the linear-time engine when its source and flags
 * are supported, and with the native engine otherwise. test(), match() and
 * friends go through exec(), so they use the same engine.
 */
class LinearRegExp extends RegExp {
	#program: LinearProgram | null;

	constructor(pattern: string | RegExp, flags?: string) {
		super(pattern, flags);
		this.#program = compileLinearProgram(this.source, this.flags);
	}

	exec(string: string): RegExpExecArray | null {
		if (!this.#program) return super.exec(string);

		const input = String(string);
		const slots = runLinearProgram(this.#program, input);
		if (!slots) return null;

		const values: (string | undefined)[] = [];
		for (let group = 0; group <= this.#program.groupCount; group++) {
			const start = slots[group * 2];
			const end = slots[group * 2 + 1];
			values.push(start >= 0 && end >= 0 ? input.slice(start, end) : undefined);
		}
		return Object.assign(values, {
			index: 0,
			input,
			groups: undefined,
		}) as RegExpExecArray;
	}
}

/**
 * Create the RegExp for a compiled pattern, using the linear-time engine for
 * regexes prone to polynomial backtracking
 */
function createPatternRegExp(source: string, flags: string): RegExp {
	// Construct natively first so invalid regexes throw the usual SyntaxError
	const regex = new RegExp(source, flags || undefined);
	return compileLinearProgram(source, flags)
		? new LinearRegExp(source, flags)
		: regex;
}

/**
 * Compile a URL component pattern (protocol, hostname, port, hash) to RegExp
 * These components don't use / as delimiter
 * @param component The component pattern to compile
 * @param ignoreCase Whether to make the regex case-insensitive
 */
function compileComponentPattern(
	component: string,
	ignoreCase: boolean = false,
): CompiledPattern {
	const paramNames: string[] = [];
	let hasWildcard = false;
	let pattern = "";
	let i = 0;
	let inIPv6Brackets = false; // Track if we're inside [...] for IPv6

	while (i < component.length) {
		const char = component[i];

		// Track IPv6 brackets
		if (char === "[" && !inIPv6Brackets) {
			inIPv6Brackets = true;
		} else if (char === "]" && inIPv6Brackets) {
			inIPv6Brackets = false;
		}

		// Handle escaped characters \<char>
		if (char === "\\") {
			if (i + 1 < component.length) {
				pattern += "\\" + component[i + 1];
				i += 2;
				continue;
			}
			pattern += "\\\\";
			i++;
			continue;
		}

		// Handle named groups :name with optional regex constraint and modifiers
		if (char === ":") {
			// Match parameter name - allow Unicode letters, numbers, underscore, and symbols (except +*?)
			const match = component
				.slice(i)
				.match(/^:(\p{ID_Continue}+)(\([^)]*\))?(\?|\+|\*)?/u);
			if (match) {
				const name = match[1];
				const constraint = match[2];
				const modifier = match[3] || "";

				// URLPattern spec: duplicate parameter names are not allowed
				if (paramNames.includes(name)) {
					throw new TypeError(
						`Invalid pattern: duplicate parameter name '${name}'`,
					);
				}
				paramNames.push(name);

				let basePattern;
				if (constraint) {
					basePattern = constraint.slice(1, -1);
				} else if (inIPv6Brackets) {
					// Inside IPv6 brackets, allow colons (e.g., [:address] matching [::1])
					// Use non-greedy matching (+?) per URLPattern spec
					basePattern = "[^\\[\\]/?#]+?";
				} else {
					// Default: match any character except delimiter (. for hostname, otherwise any)
					// Use non-greedy matching (+?) per URLPattern spec for proper group disambiguation
					basePattern = "[^./:?#]+?";
				}

				if (modifier === "?") {
					pattern += `(${basePattern})?`;
				} else if (modifier === "+") {
					pattern += `(${basePattern})+`;
				} else if (modifier === "*") {
					pattern += `(${basePattern})*`;
				} else {
					pattern += `(${basePattern})`;
				}

				i += match[0].length;
				continue;
			}
		}

		// Handle regex groups (<regex>)
		if (char === "(" && component[i + 1] !== "?") {
			let depth = 1;
			let j = i + 1;
			let regexContent = "";

			while (j < component.length && depth > 0) {
				if (component[j] === "\\") {
					regexContent += component[j] + (component[j + 1] || "");
					j += 2;
					continue;
				}
				if (component[j] === "(") depth++;
				if (component[j] === ")") depth--;
				if (depth > 0) regexContent += component[j];
				j++;
			}

			validateRegexGroupContent(regexContent);

			const modifier = component[j] || "";
			if (modifier === "?" || modifier === "+" || modifier === "*") {
				pattern += `(${regexContent})${modifier}`;
				j++;
			} else {
				pattern += `(${regexContent})`;
			}

			paramNames.push(`$${paramNames.length}`);
			i = j;
			continue;
		}

		// Handle explicit delimiters {...}
		if (char === "{") {
			const closeIndex = component.indexOf("}", i);
			if (closeIndex !== -1) {
				const content = component.slice(i + 1, closeIndex);
				const nextChar = component[closeIndex + 1] || "";
				const isModifier =
					nextChar === "?" || nextChar === "+" || nextChar === "*";

				const compiled = compileComponentPattern(content, ignoreCase);
				if (nextChar === "?") {
					pattern += `(?:${compiled.regex.source.slice(1, -1)})?`;
				} else if (nextChar === "+") {
					pattern += `(?:${compiled.regex.source.slice(1, -1)})+`;
				} else if (nextChar === "*") {
					pattern += `(?:${compiled.regex.source.slice(1, -1)})*`;
				} else {
					// No modifier - just inline the content without extra grouping
					pattern += compiled.regex.source.slice(1, -1);
				}

				paramNames.push(...compiled.paramNames);
				i = closeIndex + 1;
				if (isModifier) i++;
				continue;
			}
		}

		// Handle wildcards *
		if (char === "*") {
			hasWildcard = true;
			const modifier = component[i + 1] || "";
			if (modifier === "?" || modifier === "+" || modifier === "*") {
				pattern += `(.*)${modifier}`;
				i += 2;
			} else {
				pattern += "(.*)";
				i++;
			}
			continue;
		}

		// Escape special regex characters and encode non-ASCII
		if (".+?^${}()|[]\\".includes(char)) {
			pattern += "\\" + char;
			i++;
		} else {
			// Percent-encode non-ASCII characters for canonical form
			const code = char.charCodeAt(0);
			if (code > 127) {
				// Handle surrogate pairs (emojis, etc.) - take both code units together
				let toEncode = char;
				if (code >= 0xd800 && code <= 0xdbff && i + 1 < component.length) {
					const nextCode = component.charCodeAt(i + 1);
					if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
						toEncode = char + component[i + 1];
						i++; // Skip the low surrogate
					}
				}
				pattern += encodeURIComponent(toEncode);
				i++;
			} else {
				pattern += char;
				i++;
			}
		}
	}

	// Determine flags - use v-flag for ES2024 set operations if needed
	const needsVFlag = requiresVFlag(pattern);
	let flags = "";
	if (ignoreCase) flags += "i";
	if (needsVFlag) flags += "v";
	const regex = createPatternRegExp(`^${pattern}$`, flags);
	return {regex, paramNames, hasWildcard};
}

/**
 * Compile pathname pattern to RegExp with full URLPattern syntax support
 * @param pathname The pathname pattern to compile
 * @param encodeChars Whether to percent-encode characters that aren't allowed in URL paths (default true)
 * @param ignoreCase Whether to make the regex case-insensitive
 */
export function compilePathname(
	pathname: string,
	encodeChars: boolean = true,
	ignoreCase: boolean = false,
): CompiledPattern {
	const paramNames: string[] = [];
	let hasWildcard = false;
	let pattern = "";
	let i = 0;

	while (i < pathname.length) {
		const char = pathname[i];

		// Handle escaped characters \<char>
		if (char === "\\") {
			if (i + 1 < pathname.length) {
				const nextChar = pathname[i + 1];
				// Characters allowed unencoded in URL paths (RFC 3986 pchar)
				// Include / since \/ means "literal slash" in patterns
				const allowedInPath = (c: string) => {
					const code = c.charCodeAt(0);
					return (
						(code >= 0x41 && code <= 0x5a) || // A-Z
						(code >= 0x61 && code <= 0x7a) || // a-z
						(code >= 0x30 && code <= 0x39) || // 0-9
						"-._~!$&'()*+,;=:@/".includes(c)
					);
				};

				if (allowedInPath(nextChar)) {
					// Character is allowed in paths - match it literally
					// Escape if it's a regex special char
					if (".+?^${}()|[]\\*".includes(nextChar)) {
						pattern += "\\" + nextChar;
					} else {
						pattern += nextChar;
					}
				} else {
					// Character would be percent-encoded in paths
					// Match the percent-encoded form
					pattern += encodeURIComponent(nextChar);
				}
				i += 2;
				continue;
			}
			pattern += "\\\\";
			i++;
			continue;
		}

		// Handle named groups :name with optional regex constraint and modifiers
		if (char === ":") {
			// Match :name, :name(...), :name?, :name+, :name*, :name(...)?, etc.
			// Support Unicode identifiers per URLPattern spec
			const match = pathname
				.slice(i)
				.match(/^:(\p{ID_Continue}+)(\([^)]*\))?(\?|\+|\*)?/u);
			if (match) {
				const name = match[1];
				const constraint = match[2]; // Optional regex like (\\d+)
				const modifier = match[3] || "";

				// URLPattern spec: duplicate parameter names are not allowed
				if (paramNames.includes(name)) {
					throw new TypeError(
						`Invalid pattern: duplicate parameter name '${name}'`,
					);
				}
				paramNames.push(name);

				let basePattern;
				if (constraint) {
					// Use the regex constraint
					basePattern = constraint.slice(1, -1); // Remove parens
				} else {
					// Default: match non-slash characters (non-greedy per URLPattern spec)
					basePattern = "[^/]+?";
				}

				// URLPattern behavior: In pathname component, there's an automatic
				// prefix delimiter (/) before each param. With modifiers, both the
				// delimiter and the param become optional/repeated together.

				// Check if there's a preceding / that should be part of the optional group
				const hasPrecedingSlash = pattern.endsWith("/");

				if (modifier === "?") {
					// Optional param handling depends on what follows
					const nextChar = pathname[i + match[0].length];
					const isAtEnd = nextChar === undefined;
					const isFollowedBySlash = nextChar === "/";

					if (hasPrecedingSlash && (isAtEnd || isFollowedBySlash)) {
						// At end or followed by slash: both / and param are optional together
						// e.g., /foo/:bar? or /foo/:bar?/baz
						pattern = pattern.slice(0, -1);
						pattern += `(?:/(${basePattern}))?`;
					} else if (hasPrecedingSlash) {
						// Followed by literal: / is required, only param is optional
						// e.g., /foo/:bar?baz - the / before bar is required
						// Use * instead of + to allow empty match
						pattern += `([^/]*?)`;
					} else {
						pattern += `(${basePattern})?`;
					}
				} else if (modifier === "+") {
					// One or more: Can match multiple slash-separated segments
					// Capture as: segment or segment/segment or segment/segment/segment...
					const multiSegmentPattern = `${basePattern}(?:/${basePattern})*`;
					if (hasPrecedingSlash) {
						pattern = pattern.slice(0, -1);
						pattern += `/(${multiSegmentPattern})`;
					} else {
						pattern += `(${multiSegmentPattern})`;
					}
				} else if (modifier === "*") {
					// Zero or more: Can match nothing or multiple slash-separated segments
					const multiSegmentPattern = `${basePattern}(?:/${basePattern})*`;
					if (hasPrecedingSlash) {
						pattern = pattern.slice(0, -1);
						pattern += `(?:/(${multiSegmentPattern}))?`;
					} else {
						pattern += `(${multiSegmentPattern})?`;
					}
				} else {
					// Required parameter
					pattern += `(${basePattern})`;
				}

				i += match[0].length;
				continue;
			} else {
				// `:` not followed by valid identifier - check if it looks like an invalid param name
				// If next char is not a delimiter or pattern syntax, it's an invalid param name
				const nextChar = pathname[i + 1];
				if (nextChar && !/^[\s/?#(){}*+]$/.test(nextChar)) {
					throw new TypeError(
						`Invalid pattern: invalid parameter name character after ':'`,
					);
				}
			}
		}

		// Handle regex groups (<regex>)
		if (char === "(" && pathname[i + 1] !== "?") {
			// Find matching closing paren
			let depth = 1;
			let j = i + 1;
			let regexContent = "";

			while (j < pathname.length && depth > 0) {
				if (pathname[j] === "\\") {
					regexContent += pathname[j] + (pathname[j + 1] || "");
					j += 2;
					continue;
				}
				if (pathname[j] === "(") depth++;
				if (pathname[j] === ")") depth--;
				if (depth > 0) regexContent += pathname[j];
				j++;
			}

			validateRegexGroupContent(regexContent);

			// Check for modifier after the group
			const modifier = pathname[j] || "";
			const hasPrecedingSlash = pattern.endsWith("/");

			if (modifier === "?") {
				if (hasPrecedingSlash) {
					pattern = pattern.slice(0, -1);
					pattern += `(?:/(${regexContent}))?`;
				} else {
					pattern += `(${regexContent})?`;
				}
				j++;
			} else if (modifier === "+") {
				const multiSegmentPattern = `${regexContent}(?:/${regexContent})*`;
				if (hasPrecedingSlash) {
					pattern = pattern.slice(0, -1);
					pattern += `/(${multiSegmentPattern})`;
				} else {
					pattern += `(${regexContent})+`;
				}
				j++;
			} else if (modifier === "*") {
				const multiSegmentPattern = `${regexContent}(?:/${regexContent})*`;
				if (hasPrecedingSlash) {
					pattern = pattern.slice(0, -1);
					pattern += `(?:/(${multiSegmentPattern}))?`;
				} else {
					pattern += `(${regexContent})*`;
				}
				j++;
			} else {
				pattern += `(${regexContent})`;
			}

			// Add to param names as unnamed group
			paramNames.push(`$${paramNames.length}`);
			i = j;
			continue;
		}

		// Handle explicit delimiters {...}
		if (char === "{") {
			const closeIndex = pathname.indexOf("}", i);
			if (closeIndex !== -1) {
				const content = pathname.slice(i + 1, closeIndex);
				const nextChar = pathname[closeIndex + 1] || "";
				const isModifier =
					nextChar === "?" || nextChar === "+" || nextChar === "*";

				// Compile the content recursively
				const compiled = compilePathname(content, encodeChars, ignoreCase);
				if (nextChar === "?") {
					pattern += `(?:${compiled.regex.source.slice(1, -1)})?`;
				} else if (nextChar === "+") {
					pattern += `(?:${compiled.regex.source.slice(1, -1)})+`;
				} else if (nextChar === "*") {
					pattern += `(?:${compiled.regex.source.slice(1, -1)})*`;
				} else {
					// No modifier - just inline the content without extra grouping
					pattern += compiled.regex.source.slice(1, -1);
				}

				// Merge param names
				paramNames.push(...compiled.paramNames);

				i = closeIndex + 1;
				if (isModifier) i++;
				continue;
			}
		}

		// Handle wildcards *
		if (char === "*") {
			hasWildcard = true;
			const modifier = pathname[i + 1] || "";
			const hasPrecedingSlash = pattern.endsWith("/");
			// Use numbered names for wildcards per URLPattern spec
			paramNames.push(String(paramNames.length));

			if (modifier === "?") {
				if (hasPrecedingSlash) {
					pattern = pattern.slice(0, -1);
					pattern += `(?:/(.*))?`;
				} else {
					pattern += `(.*)?`;
				}
				i += 2;
			} else if (modifier === "+") {
				if (hasPrecedingSlash) {
					pattern = pattern.slice(0, -1);
					pattern += `/(.*)(?:/(.*))*`;
				} else {
					pattern += `(.*)+`;
				}
				i += 2;
			} else if (modifier === "*") {
				if (hasPrecedingSlash) {
					pattern = pattern.slice(0, -1);
					pattern += `(?:/(.*))*`;
				} else {
					pattern += `(.*)*`;
				}
				i += 2;
			} else {
				pattern += "(.*)";
				i++;
			}
			continue;
		}

		// Escape special regex characters and optionally encode characters not allowed in URL paths
		if (".+?^${}()|[]\\".includes(char)) {
			pattern += "\\" + char;
		} else if (encodeChars) {
			const code = char.charCodeAt(0);
			// Check if character is allowed unencoded in URL paths (RFC 3986 pchar)
			// pchar = unreserved / sub-delims / ":" / "@" / pct-encoded
			// unreserved = A-Z a-z 0-9 - . _ ~
			// sub-delims = ! $ & ' ( ) * + , ; =
			// Also include / since we're processing the whole pathname
			// Include % to preserve existing percent-encoding in patterns
			const isAllowedInPath =
				(code >= 0x41 && code <= 0x5a) || // A-Z
				(code >= 0x61 && code <= 0x7a) || // a-z
				(code >= 0x30 && code <= 0x39) || // 0-9
				"-._~!$&'()*+,;=:@/%".includes(char);

			if (isAllowedInPath) {
				pattern += char;
			} else {
				// Percent-encode (handles spaces, non-ASCII, surrogates, etc.)
				// Use safe encoding for potentially malformed UTF-16
				const code2 = char.charCodeAt(0);
				if (code2 >= 0xd800 && code2 <= 0xdbff) {
					// High surrogate - check for pair
					const nextCode =
						i + 1 < pathname.length ? pathname.charCodeAt(i + 1) : 0;
					if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
						// Valid pair - encode together
						pattern += encodeURIComponent(char + pathname[i + 1]);
						i++; // Skip the low surrogate
					} else {
						// Unpaired - use replacement character
						pattern += "%EF%BF%BD";
					}
				} else if (code2 >= 0xdc00 && code2 <= 0xdfff) {
					// Unpaired low surrogate - use replacement character
					pattern += "%EF%BF%BD";
				} else {
					pattern += encodeURIComponent(char);
				}
			}
		} else {
			// No encoding - just add the character
			pattern += char;
		}

		i++;
	}

	// Anchor pattern - use v-flag for ES2024 set operations if needed
	const needsVFlag = requiresVFlag(pattern);
	let flags = "";
	if (ignoreCase) flags += "i";
	if (needsVFlag) flags += "v";
	const regex = createPatternRegExp(`^${pattern}$`, flags);

	return {regex, paramNames, hasWildcard};
}

/**
 * Test search parameters (order-independent)
 */
function testSearchParameters(
	searchPattern: string,
	actualSearch: string,
): boolean {
	const patternParams = parseSearchPattern(searchPattern);
	// Parse actual search without decoding to preserve percent-encoding
	const actualParams = parseRawSearchParams(actualSearch);

	for (const [key, paramDef] of patternParams) {
		if (!actualParams.has(key)) {
			return false;
		}

		if (paramDef.type === "literal") {
			if (actualParams.get(key) !== paramDef.value) {
				return false;
			}
		}
	}

	return true;
}

/**
 * Parse search params without URL decoding (preserves percent-encoding)
 */
function parseRawSearchParams(search: string): Map<string, string> {
	const params = new Map<string, string>();
	if (!search) return params;

	const parts = search.split("&");
	for (const part of parts) {
		const eqIdx = part.indexOf("=");
		if (eqIdx === -1) {
			params.set(part, "");
		} else {
			params.set(part.slice(0, eqIdx), part.slice(eqIdx + 1));
		}
	}
	return params;
}

/**
 * Extract search parameters
 */
function extractSearchParams(
	searchPattern: string,
	actualParams: URLSearchParams,
): Record<string, string> {
	const params = createRecord();
	const patternParams = parseSearchPattern(searchPattern);

	for (const [key, paramDef] of patternParams) {
		const value = actualParams.get(key);
		if (value !== null) {
			if (paramDef.type === "named" && paramDef.name) {
				params[paramDef.name] = value;
			}
		}
	}

	// Also capture extra params (own-key check: params has no prototype, and
	// an empty named value must not be replaced by an extra param)
	for (const [key, value] of actualParams) {
		if (!(key in params)) {
			params[key] = value;
		}
	}

	return params;
}

/**
 * Parse search pattern
 */
interface ParamDefinition {
	type: "named" | "wildcard" | "literal";
	name?: string;
	value?: string;
}

function parseSearchPattern(pattern: string): Map<string, ParamDefinition> {
	const params = new Map<string, ParamDefinition>();
	const parts = pattern.split("&");

	for (const part of parts) {
		const [key, value] = part.split("=");
		if (!key) continue;

		// If no value (e.g., "?bar"), treat as wildcard (key must exist with any value)
		if (value === undefined) {
			params.set(key, {type: "wildcard"});
			continue;
		}

		if (value.startsWith(":")) {
			const isOptional = value.endsWith("?");
			params.set(key, {
				type: "named",
				name: value.slice(1, isOptional ? -1 : undefined),
			});
		} else if (value === "*") {
			params.set(key, {type: "wildcard"});
		} else {
			// Normalize pattern value: encode raw non-ASCII, preserve existing percent-encoding
			// - "café" → "caf%C3%A9" (raw Unicode gets encoded)
			// - "caf%C3%A9" → "caf%C3%A9" (already encoded, keep as-is)
			// - "caf%c3%a9" → "caf%c3%a9" (already encoded, keep as-is including case)
			params.set(key, {type: "literal", value: encodeSearch(value)});
		}
	}

	return params;
}

/**
 * Options for URLPattern/MatchPattern construction
 */
export interface URLPatternOptions {
	ignoreCase?: boolean;
}

/**
 * Input type for URLPattern/MatchPattern
 */
type URLPatternInit = {
	protocol?: string;
	hostname?: string;
	port?: string;
	pathname?: string;
	search?: string;
	hash?: string;
	username?: string;
	password?: string;
	baseURL?: string;
};

/**
 * All compiled patterns for a URLPattern
 */
interface CompiledPatterns {
	protocol?: CompiledPattern;
	hostname?: CompiledPattern;
	port?: CompiledPattern;
	pathname: CompiledPattern;
	search?: CompiledPattern;
	hash?: CompiledPattern;
	username?: CompiledPattern;
	password?: CompiledPattern;
}

/**
 * Compile a URLPatternInit into regex patterns
 */
function compileURLPatternInit(
	init: URLPatternInit,
	baseURL: string | undefined,
	options: {ignoreCase: boolean},
): CompiledPatterns {
	// Parse baseURL if provided
	let baseURLParsed: URL | undefined;
	const base = init.baseURL || baseURL;
	if (base) {
		try {
			baseURLParsed = new URL(base);
		} catch (err) {
			if (!(err instanceof TypeError)) throw err; // URL parse error
		}
	}

	const result: CompiledPatterns = {} as CompiledPatterns;

	// Compile protocol
	let protocol =
		init.protocol ||
		(baseURLParsed ? baseURLParsed.protocol.replace(":", "") : undefined);
	if (protocol) {
		if (protocol.endsWith(":")) {
			protocol = protocol.slice(0, -1);
		}
		result.protocol = compileComponentPattern(protocol, options.ignoreCase);
	}

	// Compile hostname
	let hostname =
		init.hostname || (baseURLParsed ? baseURLParsed.hostname : undefined);
	if (hostname) {
		validateHostnamePattern(hostname);
		hostname = normalizeHostnamePattern(hostname);
		if (hostname.startsWith("[")) {
			hostname = hostname.replace(/[A-F]/g, (c) => c.toLowerCase());
		} else {
			const hasPatternSyntax = /[{}()*+?:|\\]/.test(hostname);
			if (!hasPatternSyntax) {
				hostname = toASCII(hostname);
			}
		}
		result.hostname = compileComponentPattern(hostname, options.ignoreCase);
	}

	// Compile port
	if (init.port !== undefined) {
		let port = init.port;
		const hasPatternSyntax = /[{}()*+?:|\\]/.test(port);
		if (protocol && !hasPatternSyntax && isValidPatternPort(port)) {
			const canonicalPort = canonicalizePort(port, true);
			if (canonicalPort !== undefined) {
				const defaultPort = getDefaultPort(protocol);
				if (defaultPort && canonicalPort === defaultPort) {
					port = "";
				} else {
					port = canonicalPort;
				}
			}
		}
		result.port = compileComponentPattern(port, options.ignoreCase);
	}

	// Compile username
	if (init.username !== undefined) {
		result.username = compileComponentPattern(
			init.username,
			options.ignoreCase,
		);
	}

	// Compile password
	if (init.password !== undefined) {
		result.password = compileComponentPattern(
			init.password,
			options.ignoreCase,
		);
	}

	// Compile search
	if (init.search !== undefined) {
		let search = init.search;
		if (search.startsWith("?")) {
			search = search.slice(1);
		}
		result.search = compileComponentPattern(search, options.ignoreCase);
	}

	// Compile hash
	if (init.hash !== undefined) {
		let hash = init.hash;
		if (hash.startsWith("#")) {
			hash = hash.slice(1);
		}
		result.hash = compileComponentPattern(hash, options.ignoreCase);
	}

	// Compile pathname
	let pathname: string;
	const isNonSpecialScheme = protocol && isDefinitelyNonSpecialScheme(protocol);

	if (init.pathname !== undefined && init.pathname !== "") {
		pathname = init.pathname;
		if (baseURLParsed && !pathname.startsWith("/")) {
			// Manually resolve relative pattern against base path
			// Don't use URL constructor as it mangles pattern syntax ({, }, \, etc.)
			const basePath = baseURLParsed.pathname;
			if (basePath.endsWith("/")) {
				pathname = basePath + pathname;
			} else {
				pathname = basePath.slice(0, basePath.lastIndexOf("/") + 1) + pathname;
			}
		}
	} else if (baseURLParsed) {
		pathname = baseURLParsed.pathname;
	} else {
		// No pathname specified - use wildcard for all schemes
		pathname = "*";
	}

	if (pathname !== "" && pathname !== "*" && pathname.startsWith("/")) {
		pathname = normalizePathname(pathname);
	}

	const shouldEncodePathname = !isNonSpecialScheme;
	result.pathname = compilePathname(
		pathname,
		shouldEncodePathname,
		options.ignoreCase,
	);

	return result;
}

/**
 * Test URL components against compiled patterns (except search)
 */
function testURLComponents(compiled: CompiledPatterns, url: URL): boolean {
	// Test protocol
	if (compiled.protocol) {
		const protocol = url.protocol.replace(":", "");
		if (!compiled.protocol.regex.test(protocol)) {
			return false;
		}
	}

	// Test hostname
	if (compiled.hostname) {
		if (!compiled.hostname.regex.test(url.hostname)) {
			return false;
		}
	}

	// Test port
	if (compiled.port) {
		if (!compiled.port.regex.test(url.port)) {
			return false;
		}
	}

	// Test username
	if (compiled.username) {
		const username = encodeURIComponent(url.username);
		if (!compiled.username.regex.test(username)) {
			return false;
		}
	}

	// Test password
	if (compiled.password) {
		const password = encodeURIComponent(url.password);
		if (!compiled.password.regex.test(password)) {
			return false;
		}
	}

	// Test hash
	if (compiled.hash) {
		const hash = url.hash.replace("#", "");
		if (!compiled.hash.regex.test(hash)) {
			return false;
		}
	}

	// Test pathname
	if (!compiled.pathname.regex.test(url.pathname)) {
		return false;
	}

	return true;
}

/**
 * Test search using regex (for URLPattern)
 */
function testSearchRegex(compiled: CompiledPatterns, url: URL): boolean {
	if (compiled.search) {
		const search = url.search.replace("?", "");
		return compiled.search.regex.test(search);
	}
	return true;
}

/**
 * Test search params with order-independent matching (for MatchPattern)
 * Preserves percent-encoding for strict matching
 */
function testSearchParams(
	searchPattern: string | undefined,
	rawSearch: string,
): boolean {
	if (!searchPattern) {
		return true;
	}
	return testSearchParameters(searchPattern, rawSearch);
}

/**
 * Parse constructor arguments into normalized form
 */
function parseConstructorArgs(
	input: string | URLPatternInit | undefined,
	baseURLOrOptions: string | URLPatternOptions | undefined,
	options: URLPatternOptions | undefined,
): {
	init: URLPatternInit;
	baseURL: string | undefined;
	options: URLPatternOptions;
} {
	let baseURL: string | undefined;
	let opts: URLPatternOptions = {};

	if (input === undefined) {
		input = {};
	}

	if (typeof input === "object") {
		if (typeof baseURLOrOptions === "string") {
			throw new TypeError(
				"Invalid arguments: baseURL must be inside the object, not as second argument",
			);
		}
		opts = baseURLOrOptions || {};
		if (input.baseURL === "") {
			throw new TypeError("Invalid pattern: baseURL cannot be empty string");
		}
	} else {
		if (typeof baseURLOrOptions === "string") {
			if (baseURLOrOptions === "") {
				throw new TypeError("Invalid pattern: baseURL cannot be empty string");
			}
			baseURL = baseURLOrOptions;
			opts = options || {};
		} else if (typeof baseURLOrOptions === "object") {
			opts = baseURLOrOptions;
		}
	}

	const init = typeof input === "string" ? parseStringPattern(input) : input;
	return {init, baseURL, options: opts};
}

/**
 * URLPattern - Strict WPT-compliant URL pattern matching
 *
 * Differences from MatchPattern:
 * - Throws for relative patterns without baseURL
 * - Uses regex for search matching (order-dependent)
 * - No & syntax support
 */
export class URLPattern {
	#compiled: CompiledPatterns;
	#init: URLPatternInit;

	get pathname(): string {
		return this.#init.pathname || "*";
	}
	get search(): string {
		return this.#init.search || "*";
	}
	get protocol(): string {
		return this.#init.protocol || "*";
	}
	get hostname(): string {
		return this.#init.hostname || "*";
	}
	get port(): string {
		return this.#init.port || "*";
	}
	get username(): string {
		return this.#init.username || "*";
	}
	get password(): string {
		return this.#init.password || "*";
	}
	get hash(): string {
		return this.#init.hash || "*";
	}

	constructor(
		input?: string | URLPatternInit,
		baseURLOrOptions?: string | URLPatternOptions,
		options?: URLPatternOptions,
	) {
		const {
			init,
			baseURL,
			options: opts,
		} = parseConstructorArgs(input, baseURLOrOptions, options);

		// Strict: require baseURL for relative string patterns (not object patterns)
		// Only strings like "/foo" are relative - object patterns like {pathname: "/foo"} are partial and valid
		if (
			typeof input === "string" &&
			!init.protocol &&
			!baseURL &&
			!init.baseURL
		) {
			throw new TypeError(
				"Invalid pattern: relative URL pattern requires a baseURL",
			);
		}

		this.#init = init;
		this.#compiled = compileURLPatternInit(init, baseURL, {
			ignoreCase: opts.ignoreCase ?? false,
		});
	}

	test(input?: string | URL | URLPatternInit, baseURL?: string): boolean {
		if (input === undefined) {
			input = {};
		}

		// Handle URLPatternInit object
		if (typeof input === "object" && !(input instanceof URL)) {
			return this.#testInit(input, baseURL);
		}

		// Handle string and URL inputs
		let url: URL;
		if (typeof input === "string") {
			try {
				url = baseURL ? new URL(input, baseURL) : new URL(input);
			} catch (err) {
				if (!(err instanceof TypeError)) throw err; // URL parse error
				return false;
			}
		} else {
			url = input;
		}

		// Test all components
		if (!testURLComponents(this.#compiled, url)) {
			return false;
		}

		// Test search with regex (order-dependent)
		return testSearchRegex(this.#compiled, url);
	}

	#testInit(input: URLPatternInit, baseURL?: string): boolean {
		const base = input.baseURL || baseURL;
		let baseURLObj: URL | undefined;
		if (base) {
			try {
				baseURLObj = new URL(base);
			} catch (err) {
				if (!(err instanceof TypeError)) throw err; // URL parse error
			}
		}

		// Test protocol
		const protocol =
			input.protocol ?? baseURLObj?.protocol.replace(":", "") ?? undefined;
		if (protocol !== undefined && !isValidProtocol(protocol)) return false;
		if (this.#compiled.protocol) {
			if (
				protocol === undefined ||
				!this.#compiled.protocol.regex.test(protocol)
			)
				return false;
		}

		// Test hostname
		if (this.#compiled.hostname) {
			let hostname = input.hostname ?? baseURLObj?.hostname;
			if (hostname === undefined) return false;
			hostname = toASCII(hostname);
			if (!this.#compiled.hostname.regex.test(hostname)) return false;
		}

		// Test port
		let port = input.port ?? baseURLObj?.port;
		if (port !== undefined) {
			const canonical = canonicalizePort(port);
			if (canonical === undefined) return false;
			port = canonical;
			if (protocol) {
				const defaultPort = getDefaultPort(protocol);
				if (defaultPort && port === defaultPort) port = "";
			}
		}
		if (this.#compiled.port) {
			if (port === undefined || !this.#compiled.port.regex.test(port))
				return false;
		}

		// Test username/password
		if (this.#compiled.username) {
			const username = input.username ?? baseURLObj?.username;
			if (
				username === undefined ||
				!this.#compiled.username.regex.test(encodeURIComponent(username))
			)
				return false;
		}
		if (this.#compiled.password) {
			const password = input.password ?? baseURLObj?.password;
			if (
				password === undefined ||
				!this.#compiled.password.regex.test(encodeURIComponent(password))
			)
				return false;
		}

		// Test pathname
		let pathname = input.pathname ?? baseURLObj?.pathname ?? "/";
		// Resolve relative pathname against baseURL
		if (baseURLObj && !pathname.startsWith("/")) {
			// Manually resolve to preserve pattern syntax
			const basePath = baseURLObj.pathname;
			if (basePath.endsWith("/")) {
				pathname = basePath + pathname;
			} else {
				pathname = basePath.slice(0, basePath.lastIndexOf("/") + 1) + pathname;
			}
		}
		if (pathname.startsWith("/")) pathname = normalizePathname(pathname);
		const shouldEncode = !protocol || isSpecialScheme(protocol);
		if (shouldEncode) pathname = encodePathname(pathname);
		if (!this.#compiled.pathname.regex.test(pathname)) return false;

		// Test hash
		if (this.#compiled.hash) {
			let hash = input.hash ?? baseURLObj?.hash.replace("#", "") ?? undefined;
			if (hash === undefined) return false;
			if (hash.startsWith("#")) hash = hash.slice(1);
			hash = encodeHash(hash);
			if (!this.#compiled.hash.regex.test(hash)) return false;
		}

		// Test search with regex (order-dependent)
		if (this.#compiled.search) {
			let search = input.search ?? baseURLObj?.search?.replace("?", "") ?? "";
			if (search.startsWith("?")) search = search.slice(1);
			search = encodeSearch(search);
			if (!this.#compiled.search.regex.test(search)) return false;
		}

		return true;
	}

	exec(
		input: string | URL | URLPatternInit,
		baseURL?: string,
	): MatchPatternResult | null {
		if (!this.test(input, baseURL)) return null;

		// Handle URLPatternInit
		if (typeof input === "object" && !(input instanceof URL)) {
			return this.#execInit(input, baseURL);
		}

		// Handle URL
		let url: URL;
		if (typeof input === "string") {
			url = baseURL ? new URL(input, baseURL) : new URL(input);
		} else {
			url = input;
		}

		const params = createRecord();
		const pathnameGroups = createRecord();
		const searchGroups = createRecord();

		// Extract pathname params
		const match = this.#compiled.pathname.regex.exec(url.pathname);
		if (match) {
			for (let i = 0; i < this.#compiled.pathname.paramNames.length; i++) {
				const name = this.#compiled.pathname.paramNames[i];
				const value = match[i + 1];
				if (value !== undefined) {
					params[name] = value;
					pathnameGroups[name] = value;
				}
			}
		}

		// Extract search params from regex
		if (this.#compiled.search) {
			const search = url.search.replace("?", "");
			const searchMatch = this.#compiled.search.regex.exec(search);
			if (searchMatch) {
				for (let i = 0; i < this.#compiled.search.paramNames.length; i++) {
					const name = this.#compiled.search.paramNames[i];
					const value = searchMatch[i + 1];
					if (value !== undefined) {
						searchGroups[name] = value;
						// Pathname params take precedence in the unified params
						if (!this.#compiled.pathname.paramNames.includes(name)) {
							params[name] = value;
						}
					}
				}
			}
		}

		return {
			params,
			pathname: {input: url.pathname, groups: pathnameGroups},
			search: {input: url.search, groups: searchGroups},
			protocol: {input: url.protocol, groups: {}},
			hostname: {input: url.hostname, groups: {}},
			port: {input: url.port, groups: {}},
			username: {input: url.username, groups: {}},
			password: {input: url.password, groups: {}},
			hash: {input: url.hash, groups: {}},
			inputs: [input],
		};
	}

	#execInit(input: URLPatternInit, baseURL?: string): MatchPatternResult {
		const base = input.baseURL || baseURL;
		let baseURLObj: URL | undefined;
		if (base) {
			try {
				baseURLObj = new URL(base);
			} catch (err) {
				if (!(err instanceof TypeError)) throw err; // URL parse error
			}
		}

		let pathname = input.pathname ?? baseURLObj?.pathname ?? "/";
		pathname = normalizePathname(pathname);

		const params = createRecord();
		const pathnameGroups = createRecord();
		const searchGroups = createRecord();

		const match = this.#compiled.pathname.regex.exec(pathname);
		if (match) {
			for (let i = 0; i < this.#compiled.pathname.paramNames.length; i++) {
				const name = this.#compiled.pathname.paramNames[i];
				const value = match[i + 1];
				if (value !== undefined) {
					params[name] = value;
					pathnameGroups[name] = value;
				}
			}
		}

		if (this.#compiled.search) {
			let search = input.search ?? baseURLObj?.search?.replace("?", "") ?? "";
			if (search.startsWith("?")) search = search.slice(1);
			const searchMatch = this.#compiled.search.regex.exec(search);
			if (searchMatch) {
				for (let i = 0; i < this.#compiled.search.paramNames.length; i++) {
					const name = this.#compiled.search.paramNames[i];
					const value = searchMatch[i + 1];
					if (value !== undefined) {
						searchGroups[name] = value;
						// Pathname params take precedence in the unified params
						if (!this.#compiled.pathname.paramNames.includes(name)) {
							params[name] = value;
						}
					}
				}
			}
		}

		const protocol =
			input.protocol ?? baseURLObj?.protocol.replace(":", "") ?? "";
		const hostname = input.hostname ?? baseURLObj?.hostname ?? "";
		let port = input.port ?? baseURLObj?.port ?? "";
		if (port) port = canonicalizePort(port) || "";
		const hash = input.hash ?? baseURLObj?.hash?.replace("#", "") ?? "";
		const search = input.search ?? baseURLObj?.search?.replace("?", "") ?? "";

		return {
			params,
			pathname: {input: pathname, groups: pathnameGroups},
			search: {input: search ? `?${search}` : "", groups: searchGroups},
			protocol: {input: protocol ? `${protocol}:` : "", groups: {}},
			hostname: {input: hostname, groups: {}},
			port: {input: port, groups: {}},
			username: {input: "", groups: {}},
			password: {input: "", groups: {}},
			hash: {input: hash ? `#${hash}` : "", groups: {}},
			inputs: [input],
		};
	}
}

/**
 * MatchPattern - URL pattern matching with conveniences for routing
 *
 * Features:
 * - Relative paths without baseURL ("/users/:id" works)
 * - & syntax for search params ("/api&format=json")
 * - Order-independent search matching
 */
export class MatchPattern {
	#compiled: CompiledPatterns;
	#searchPattern?: string;
	#init: URLPatternInit;

	get pathname(): string {
		return this.#init.pathname || "*";
	}
	get search(): string | undefined {
		return this.#searchPattern;
	}
	get protocol(): string | undefined {
		return this.#init.protocol;
	}
	get hostname(): string | undefined {
		return this.#init.hostname;
	}
	get port(): string | undefined {
		return this.#init.port;
	}
	get username(): string | undefined {
		return this.#init.username;
	}
	get password(): string | undefined {
		return this.#init.password;
	}
	get hash(): string | undefined {
		return this.#init.hash;
	}

	constructor(
		input?: string | URLPatternInit,
		baseURLOrOptions?: string | URLPatternOptions,
		options?: URLPatternOptions,
	) {
		const {
			init,
			baseURL,
			options: opts,
		} = parseConstructorArgs(input, baseURLOrOptions, options);
		this.#init = init;
		this.#searchPattern = init.search;
		this.#compiled = compileURLPatternInit(init, baseURL, {
			ignoreCase: opts.ignoreCase ?? false,
		});
	}

	test(input?: string | URL | URLPatternInit, baseURL?: string): boolean {
		if (input === undefined) {
			input = {};
		}

		// Handle URLPatternInit object
		if (typeof input === "object" && !(input instanceof URL)) {
			return this.#testInit(input, baseURL);
		}

		// Handle string and URL inputs
		let url: URL;
		if (typeof input === "string") {
			try {
				url = baseURL ? new URL(input, baseURL) : new URL(input);
			} catch (err) {
				if (!(err instanceof TypeError)) throw err; // URL parse error
				return false;
			}
		} else {
			url = input;
		}

		// Test all components except search
		if (!testURLComponents(this.#compiled, url)) {
			return false;
		}

		// Test search - use regex if pattern contains URLPattern syntax (like :name)
		// otherwise use order-independent key-value matching
		if (this.#searchPattern && !this.#searchPattern.includes("=")) {
			// Pattern-style search (like :café or *) - use regex matching
			return testSearchRegex(this.#compiled, url);
		}
		// Key-value style search - use order-independent matching
		// Use raw search string (without ?) to preserve percent-encoding
		const rawSearch = url.search.startsWith("?")
			? url.search.slice(1)
			: url.search;
		return testSearchParams(this.#searchPattern, rawSearch);
	}

	#testInit(input: URLPatternInit, baseURL?: string): boolean {
		const base = input.baseURL || baseURL;
		let baseURLObj: URL | undefined;
		if (base) {
			try {
				baseURLObj = new URL(base);
			} catch (err) {
				if (!(err instanceof TypeError)) throw err; // URL parse error
			}
		}

		// Test protocol
		const protocol =
			input.protocol ?? baseURLObj?.protocol.replace(":", "") ?? undefined;
		if (protocol !== undefined && !isValidProtocol(protocol)) return false;
		if (this.#compiled.protocol) {
			if (
				protocol === undefined ||
				!this.#compiled.protocol.regex.test(protocol)
			)
				return false;
		}

		// Test hostname
		if (this.#compiled.hostname) {
			let hostname = input.hostname ?? baseURLObj?.hostname;
			if (hostname === undefined) return false;
			hostname = toASCII(hostname);
			if (!this.#compiled.hostname.regex.test(hostname)) return false;
		}

		// Test port
		let port = input.port ?? baseURLObj?.port;
		if (port !== undefined) {
			const canonical = canonicalizePort(port);
			if (canonical === undefined) return false;
			port = canonical;
			if (protocol) {
				const defaultPort = getDefaultPort(protocol);
				if (defaultPort && port === defaultPort) port = "";
			}
		}
		if (this.#compiled.port) {
			if (port === undefined || !this.#compiled.port.regex.test(port))
				return false;
		}

		// Test username/password
		if (this.#compiled.username) {
			const username = input.username ?? baseURLObj?.username;
			if (
				username === undefined ||
				!this.#compiled.username.regex.test(encodeURIComponent(username))
			)
				return false;
		}
		if (this.#compiled.password) {
			const password = input.password ?? baseURLObj?.password;
			if (
				password === undefined ||
				!this.#compiled.password.regex.test(encodeURIComponent(password))
			)
				return false;
		}

		// Test pathname
		let pathname = input.pathname ?? baseURLObj?.pathname ?? "/";
		// Resolve relative pathname against baseURL
		if (baseURLObj && !pathname.startsWith("/")) {
			try {
				const resolved = new URL(pathname, baseURLObj.href);
				pathname = resolved.pathname;
			} catch (err) {
				if (!(err instanceof TypeError)) throw err; // URL parse error
				const basePath = baseURLObj.pathname;
				if (basePath.endsWith("/")) {
					pathname = basePath + pathname;
				} else {
					pathname =
						basePath.slice(0, basePath.lastIndexOf("/") + 1) + pathname;
				}
			}
		}
		if (pathname.startsWith("/")) pathname = normalizePathname(pathname);
		const shouldEncode = !protocol || isSpecialScheme(protocol);
		if (shouldEncode) pathname = encodePathname(pathname);
		if (!this.#compiled.pathname.regex.test(pathname)) return false;

		// Test hash
		if (this.#compiled.hash) {
			let hash = input.hash ?? baseURLObj?.hash.replace("#", "") ?? undefined;
			if (hash === undefined) return false;
			if (hash.startsWith("#")) hash = hash.slice(1);
			hash = encodeHash(hash);
			if (!this.#compiled.hash.regex.test(hash)) return false;
		}

		// Test search - use regex if pattern contains URLPattern syntax (like :name)
		// otherwise use order-independent key-value matching
		if (this.#searchPattern) {
			let search = input.search ?? baseURLObj?.search?.replace("?", "") ?? "";
			if (search.startsWith("?")) search = search.slice(1);
			// Normalize search to canonical percent-encoding (uppercase hex)
			search = encodeSearch(search);

			if (!this.#searchPattern.includes("=")) {
				// Pattern-style search (like :café or *) - use regex matching
				if (this.#compiled.search) {
					return this.#compiled.search.regex.test(search);
				}
				return true;
			}
			// Key-value style search - use order-independent matching
			return testSearchParams(this.#searchPattern, search);
		}

		return true;
	}

	/**
	 * Copy search params into the unified params, skipping any name declared in
	 * the pathname pattern so that e.g. "?id=2" can't spoof "/users/:id"
	 */
	#mergeSearchParams(
		params: Record<string, string>,
		searchGroups: Record<string, string>,
	): void {
		const pathnameNames = this.#compiled.pathname.paramNames;
		for (const key in searchGroups) {
			if (!pathnameNames.includes(key)) {
				params[key] = searchGroups[key];
			}
		}
	}

	exec(
		input: string | URL | URLPatternInit,
		baseURL?: string,
	): MatchPatternResult | null {
		if (!this.test(input, baseURL)) return null;

		// Handle URLPatternInit
		if (typeof input === "object" && !(input instanceof URL)) {
			return this.#execInit(input, baseURL);
		}

		// Handle URL
		let url: URL;
		if (typeof input === "string") {
			url = baseURL ? new URL(input, baseURL) : new URL(input);
		} else {
			url = input;
		}

		const params = createRecord();
		const pathnameGroups = createRecord();
		const searchGroups = createRecord();

		// Extract pathname params
		const match = this.#compiled.pathname.regex.exec(url.pathname);
		if (match) {
			for (let i = 0; i < this.#compiled.pathname.paramNames.length; i++) {
				const name = this.#compiled.pathname.paramNames[i];
				const value = match[i + 1];
				if (value !== undefined) {
					params[name] = value;
					pathnameGroups[name] = value;
				}
			}
		}

		// Extract search params
		if (this.#searchPattern) {
			const extracted = extractSearchParams(
				this.#searchPattern,
				url.searchParams,
			);
			Object.assign(searchGroups, extracted);
		} else {
			for (const [key, value] of url.searchParams) {
				searchGroups[key] = value;
			}
		}
		this.#mergeSearchParams(params, searchGroups);

		return {
			params,
			pathname: {input: url.pathname, groups: pathnameGroups},
			search: {input: url.search, groups: searchGroups},
			protocol: {input: url.protocol, groups: {}},
			hostname: {input: url.hostname, groups: {}},
			port: {input: url.port, groups: {}},
			username: {input: url.username, groups: {}},
			password: {input: url.password, groups: {}},
			hash: {input: url.hash, groups: {}},
			inputs: [input],
		};
	}

	#execInit(input: URLPatternInit, baseURL?: string): MatchPatternResult {
		const base = input.baseURL || baseURL;
		let baseURLObj: URL | undefined;
		if (base) {
			try {
				baseURLObj = new URL(base);
			} catch (err) {
				if (!(err instanceof TypeError)) throw err; // URL parse error
			}
		}

		let pathname = input.pathname ?? baseURLObj?.pathname ?? "/";
		pathname = normalizePathname(pathname);

		const params = createRecord();
		const pathnameGroups = createRecord();
		const searchGroups = createRecord();

		const match = this.#compiled.pathname.regex.exec(pathname);
		if (match) {
			for (let i = 0; i < this.#compiled.pathname.paramNames.length; i++) {
				const name = this.#compiled.pathname.paramNames[i];
				const value = match[i + 1];
				if (value !== undefined) {
					params[name] = value;
					pathnameGroups[name] = value;
				}
			}
		}

		if (this.#searchPattern) {
			const search = input.search ?? baseURLObj?.search?.replace("?", "") ?? "";
			const extracted = extractSearchParams(
				this.#searchPattern,
				new URLSearchParams(search),
			);
			Object.assign(searchGroups, extracted);
			this.#mergeSearchParams(params, searchGroups);
		}

		const protocol =
			input.protocol ?? baseURLObj?.protocol.replace(":", "") ?? "";
		const hostname = input.hostname ?? baseURLObj?.hostname ?? "";
		let port = input.port ?? baseURLObj?.port ?? "";
		if (port) port = canonicalizePort(port) || "";
		const hash = input.hash ?? baseURLObj?.hash?.replace("#", "") ?? "";
		const search = input.search ?? baseURLObj?.search?.replace("?", "") ?? "";

		return {
			params,
			pathname: {input: pathname, groups: pathnameGroups},
			search: {input: search ? `?${search}` : "", groups: searchGroups},
			protocol: {input: protocol ? `${protocol}:` : "", groups: {}},
			hostname: {input: hostname, groups: {}},
			port: {input: port, groups: {}},
			username: {input: "", groups: {}},
			password: {input: "", groups: {}},
			hash: {input: hash ? `#${hash}` : "", groups: {}},
			inputs: [input],
		};
	}
}

/**
 * Fast MatchPattern implementation using pure RegExp
 * 60x faster than URLPattern polyfill
 *
 * Supports:
 * - Static paths: "/users"
 * - Named parameters: "/users/:id"
 * - Optional parameters: "/users/:id?"
 * - Wildcards: "/files/*"
 * - Search params: "/api&format=:format"
 * - Full URLs: "https://api.example.com/posts/:id"
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
function isDefinitelyNonSpecialScheme(protocolPattern: string | undefined): boolean {
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
		return alternatives.every(alt => !isSpecialScheme(alt.trim()));
	}

	// Check for named parameter patterns
	if (protocolPattern.includes(":")) {
		return false; // Named params could match anything
	}

	// Simple literal protocol
	return !isSpecialScheme(protocolPattern);
}

/**
 * Get the default port for a protocol, per URL spec
 */
function getDefaultPort(protocol: string): string | undefined {
	const defaults: Record<string, string> = {
		"http": "80",
		"https": "443",
		"ws": "80",
		"wss": "443",
		"ftp": "21",
	};
	return defaults[protocol.toLowerCase()];
}

/**
 * Convert IDN (Internationalized Domain Name) to ASCII/Punycode form
 * e.g., "🚲.com" -> "xn--h78h.com", "münchen.de" -> "xn--mnchen-3ya.de"
 * Returns original hostname if conversion fails
 */
function toASCII(hostname: string): string {
	try {
		return new URL("http://" + hostname).hostname;
	} catch {
		return hostname;
	}
}

/**
 * Canonicalize port value per URL spec
 * Strips ASCII tab/newline/CR, extracts leading digits
 * Returns canonicalized port or undefined if invalid
 * Note: Does not validate range for pattern matching purposes
 */
function canonicalizePort(port: string, throwOnInvalid: boolean = false): string | undefined {
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
	// Decode first if already encoded, then re-encode for canonical form
	try {
		const decoded = decodeURIComponent(search);
		// Encode but preserve = and &
		return encodeURIComponent(decoded)
			.replace(/%3D/g, "=")
			.replace(/%26/g, "&");
	} catch {
		// If decoding fails, just encode as-is
		return encodeURIComponent(search)
			.replace(/%3D/g, "=")
			.replace(/%26/g, "&");
	}
}

/**
 * Percent-encode a hash component
 */
function encodeHash(hash: string): string {
	// Decode first if already encoded, then re-encode for canonical form
	try {
		return encodeURIComponent(decodeURIComponent(hash));
	} catch {
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
 * Result of pattern matching
 */
export interface MatchPatternResult {
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
interface CompiledPattern {
	regex: RegExp;
	paramNames: string[];
	hasWildcard: boolean;
}

/**
 * Find the index of a question mark that acts as search delimiter in a URL pattern
 *
 * In URLPattern syntax:
 * - `?` after pattern modifiers (*, +, ), :name) is a modifier meaning "optional"
 * - `?` in other positions (after hostname, after a complete path) is the search delimiter
 * - `\?` is always the search delimiter (escaped)
 *
 * Returns -1 if no search delimiter is found
 */
function findSearchDelimiter(pattern: string): { index: number; offset: number } {
	// First, look for escaped ? which is always a delimiter
	for (let i = 0; i < pattern.length - 1; i++) {
		if (pattern[i] === "\\" && pattern[i + 1] === "?") {
			return { index: i, offset: 2 }; // Skip both \ and ?
		}
	}

	// Look for unescaped ? that is a search delimiter (not a modifier)
	// It's a modifier if it follows: * + ) } or a named param like :name
	for (let i = 0; i < pattern.length; i++) {
		if (pattern[i] === "?") {
			// Check what precedes the ?
			const prev = i > 0 ? pattern[i - 1] : "";

			// If preceded by modifier chars (* + ) }) or right after a named param, it's a modifier
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
			return { index: i, offset: 1 };
		}
	}

	return { index: -1, offset: 0 };
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
		return { search: pattern.slice(1) };
	}

	// Handle hash-only patterns starting with #
	if (pattern.startsWith("#")) {
		return { hash: pattern.slice(1) };
	}

	// Check for non-hierarchical scheme (e.g., "data:", "javascript:", "mailto:")
	// These don't use :// so we need to detect them explicitly
	// Match: protocol + ":" + optional rest (no // after the :)
	const nonHierarchicalMatch = pattern.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*):/);
	if (nonHierarchicalMatch && !pattern.startsWith(nonHierarchicalMatch[0] + "/")) {
		const protocol = nonHierarchicalMatch[1];
		// Skip if this looks like it has :// (hierarchical)
		if (pattern.startsWith(protocol + "://")) {
			// Fall through to hierarchical handling
		} else {
			const rest = pattern.slice(nonHierarchicalMatch[0].length);

			// Extract hash first
			const hashIndex = rest.indexOf("#");
			const hash = hashIndex === -1 ? undefined : rest.slice(hashIndex + 1);
			const beforeHash = hashIndex === -1 ? rest : rest.slice(0, hashIndex);

			// Extract search
			const searchDelim = findSearchDelimiter(beforeHash);
			const search = searchDelim.index === -1 ? undefined : beforeHash.slice(searchDelim.index + searchDelim.offset);
			const pathname = searchDelim.index === -1 ? beforeHash : beforeHash.slice(0, searchDelim.index);

			return { protocol, pathname, search, hash };
		}
	}

	// Check for non-hierarchical scheme with escaped colon (e.g., "data\:foobar")
	// The \: indicates this is a protocol separator for non-special schemes
	const escapedColonMatch = pattern.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*)\\:/);
	if (escapedColonMatch) {
		const protocol = escapedColonMatch[1];
		const rest = pattern.slice(escapedColonMatch[0].length);

		// Extract hash first
		const hashIndex = rest.indexOf("#");
		const hash = hashIndex === -1 ? undefined : rest.slice(hashIndex + 1);
		const beforeHash = hashIndex === -1 ? rest : rest.slice(0, hashIndex);

		// Extract search
		const searchDelim = findSearchDelimiter(beforeHash);
		const search = searchDelim.index === -1 ? undefined : beforeHash.slice(searchDelim.index + searchDelim.offset);
		const pathname = searchDelim.index === -1 ? beforeHash : beforeHash.slice(0, searchDelim.index);

		return { protocol, pathname, search, hash };
	}

	// Check if it's a full URL with :// (including protocol patterns like http{s}?://)
	// Match protocols that may have pattern syntax like {s}? before ://
	const protocolMatch = pattern.match(/^([a-zA-Z][a-zA-Z0-9+\-.]*(?:\{[^}]*\}\??)?):/);
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
		if (searchDelim.index !== -1 && (ampIndex === -1 || searchDelim.index < ampIndex)) {
			queryIndex = searchDelim.index;
			searchOffset = searchDelim.offset;
		} else if (ampIndex !== -1) {
			queryIndex = ampIndex;
			searchOffset = 1; // Skip just &
		}

		const search = queryIndex === -1 ? undefined : beforeHash.slice(queryIndex + searchOffset);
		const urlPart = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);

		// Find where :// is to split protocol from rest
		const schemeEndIdx = urlPart.indexOf("://");
		const protocol = urlPart.slice(0, schemeEndIdx);
		let afterScheme = urlPart.slice(schemeEndIdx + 3);

		// Extract username and password (userinfo before @)
		// Look for @ but not inside [...] (IPv6)
		let username: string | undefined;
		let password: string | undefined;
		let atIndex = -1;
		let bracketDepth = 0;
		for (let i = 0; i < afterScheme.length; i++) {
			const char = afterScheme[i];
			if (char === "[") bracketDepth++;
			else if (char === "]") bracketDepth--;
			else if (char === "@" && bracketDepth === 0) {
				atIndex = i;
				break;
			} else if (char === "/" && bracketDepth === 0) {
				// Reached pathname without finding @
				break;
			}
		}

		if (atIndex !== -1) {
			const userinfo = afterScheme.slice(0, atIndex);
			afterScheme = afterScheme.slice(atIndex + 1);

			// Split userinfo into username:password
			// Look for unescaped : to split
			let colonIndex = -1;
			for (let i = 0; i < userinfo.length; i++) {
				if (userinfo[i] === "\\" && i + 1 < userinfo.length) {
					i++; // Skip escaped char
					continue;
				}
				if (userinfo[i] === ":") {
					colonIndex = i;
					break;
				}
			}

			if (colonIndex !== -1) {
				username = userinfo.slice(0, colonIndex);
				password = userinfo.slice(colonIndex + 1);
			} else {
				username = userinfo;
			}
		}

		// Extract pathname (starts with first / after ://)
		const pathnameStart = afterScheme.indexOf("/");
		const pathname = pathnameStart === -1 ? "/" : afterScheme.slice(pathnameStart);

		// Extract host part (hostname + optional port)
		const hostPart = pathnameStart === -1 ? afterScheme : afterScheme.slice(0, pathnameStart);

		// Extract port - look for :digits at the end, but be careful with pattern syntax
		// Port patterns can be :8080 or :(80|443) or :80{80}?
		const portMatch = hostPart.match(/:(\d+|\([^)]+\)|\d*\{[^}]+\}\??)$/);
		// When parsing a URL string, port is explicitly "" if not specified (not undefined)
		// This means "port must be empty or default", as opposed to undefined which means "any port"
		const port = portMatch ? portMatch[1] : "";

		// Extract hostname (without port)
		const hostname = portMatch ? hostPart.slice(0, -portMatch[0].length) : hostPart;

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
		if (searchDelim.index !== -1 && (ampIndex === -1 || searchDelim.index < ampIndex)) {
			queryIndex = searchDelim.index;
			searchOffset = searchDelim.offset;
		} else if (ampIndex !== -1) {
			queryIndex = ampIndex;
			searchOffset = 1;
		}

		const search = queryIndex === -1 ? undefined : beforeHash.slice(queryIndex + searchOffset);
		const pathname = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);

		return { pathname, search, hash };
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

/**
 * Compile a URL component pattern (protocol, hostname, port, hash) to RegExp
 * These components don't use / as delimiter
 * @param component The component pattern to compile
 * @param ignoreCase Whether to make the regex case-insensitive
 */
function compileComponentPattern(component: string, ignoreCase: boolean = false): CompiledPattern {
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
			const match = component.slice(i).match(/^:((?:[\p{L}\p{N}_]|(?![+*?])[\p{S}])+)(\([^)]*\))?(\?|\+|\*)?/u);
			if (match) {
				const name = match[1];
				const constraint = match[2];
				const modifier = match[3] || "";
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
				const isModifier = nextChar === "?" || nextChar === "+" || nextChar === "*";

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
				if (code >= 0xD800 && code <= 0xDBFF && i + 1 < component.length) {
					const nextCode = component.charCodeAt(i + 1);
					if (nextCode >= 0xDC00 && nextCode <= 0xDFFF) {
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

	const flags = ignoreCase ? "i" : undefined;
	const regex = new RegExp(`^${pattern}$`, flags);
	return {regex, paramNames, hasWildcard};
}

/**
 * Compile pathname pattern to RegExp with full URLPattern syntax support
 * @param pathname The pathname pattern to compile
 * @param encodeChars Whether to percent-encode characters that aren't allowed in URL paths (default true)
 * @param ignoreCase Whether to make the regex case-insensitive
 */
function compilePathname(pathname: string, encodeChars: boolean = true, ignoreCase: boolean = false): CompiledPattern {
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
			// Support Unicode identifiers per URLPattern spec (including symbols except +*?)
			const match = pathname.slice(i).match(/^:((?:[\p{L}\p{N}_]|(?![+*?])[\p{S}])+)(\([^)]*\))?(\?|\+|\*)?/u);
			if (match) {
				const name = match[1];
				const constraint = match[2]; // Optional regex like (\\d+)
				const modifier = match[3] || "";
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
					// Optional: Both / and param are optional
					if (hasPrecedingSlash) {
						// Remove the trailing / we just added
						pattern = pattern.slice(0, -1);
						pattern += `(?:/(${basePattern}))?`;
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
				const isModifier = nextChar === "?" || nextChar === "+" || nextChar === "*";

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
				// Percent-encode (handles spaces, non-ASCII, etc.)
				pattern += encodeURIComponent(char);
			}
		} else {
			// No encoding - just add the character
			pattern += char;
		}

		i++;
	}

	// Anchor pattern
	const flags = ignoreCase ? "i" : undefined;
	const regex = new RegExp(`^${pattern}$`, flags);

	return {regex, paramNames, hasWildcard};
}

/**
 * Test search parameters (order-independent)
 */
function testSearchParameters(
	searchPattern: string,
	actualParams: URLSearchParams,
): boolean {
	const patternParams = parseSearchPattern(searchPattern);

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
 * Extract search parameters
 */
function extractSearchParams(
	searchPattern: string,
	actualParams: URLSearchParams,
): Record<string, string> {
	const params: Record<string, string> = {};
	const patternParams = parseSearchPattern(searchPattern);

	for (const [key, paramDef] of patternParams) {
		const value = actualParams.get(key);
		if (value !== null) {
			if (paramDef.type === "named" && paramDef.name) {
				params[paramDef.name] = value;
			}
		}
	}

	// Also capture extra params
	for (const [key, value] of actualParams) {
		if (!params[key]) {
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
			// Decode the literal value for canonical comparison
			// URLSearchParams decodes values, so we need to decode pattern values too
			const decodedValue = decodeURIComponent(value);
			params.set(key, {type: "literal", value: decodedValue});
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
 * MatchPattern provides fast URL pattern matching using RegExp
 */
export class MatchPattern {
	#pathnameCompiled: CompiledPattern;
	#protocolCompiled?: CompiledPattern;
	#hostnameCompiled?: CompiledPattern;
	#portCompiled?: CompiledPattern;
	#hashCompiled?: CompiledPattern;
	#searchCompiled?: CompiledPattern;
	#usernameCompiled?: CompiledPattern;
	#passwordCompiled?: CompiledPattern;
	#searchPattern?: string; // Legacy: for & syntax search params
	#originalInput: string | {pathname?: string; search?: string; protocol?: string; hostname?: string; port?: string; hash?: string; username?: string; password?: string};
	#ignoreCase: boolean;

	// Expose pathname for router introspection
	get pathname(): string {
		if (typeof this.#originalInput === "string") {
			const parsed = parseStringPattern(this.#originalInput);
			return parsed.pathname || "/";
		}
		return this.#originalInput.pathname || "/";
	}

	get search(): string | undefined {
		return this.#searchPattern;
	}

	get protocol(): string | undefined {
		if (typeof this.#originalInput === "string") {
			const parsed = parseStringPattern(this.#originalInput);
			return parsed.protocol;
		}
		return this.#originalInput.protocol;
	}

	get hostname(): string | undefined {
		if (typeof this.#originalInput === "string") {
			const parsed = parseStringPattern(this.#originalInput);
			return parsed.hostname;
		}
		return this.#originalInput.hostname;
	}

	get port(): string | undefined {
		return this.#originalInput && typeof this.#originalInput === "object" ? this.#originalInput.port : undefined;
	}

	get hash(): string | undefined {
		return this.#originalInput && typeof this.#originalInput === "object" ? this.#originalInput.hash : undefined;
	}

	constructor(
		input?: string | {pathname?: string; search?: string; protocol?: string; hostname?: string; port?: string; username?: string; password?: string; hash?: string; baseURL?: string},
		baseURLOrOptions?: string | URLPatternOptions,
		options?: URLPatternOptions,
	) {
		// Parse arguments based on input type
		// For object input: second arg is options (baseURL is inside the object)
		// For string input: second arg can be baseURL (string) or options (object), third arg is options if second is baseURL
		// For no input: create a wildcard pattern that matches anything (per URLPattern spec)
		let baseURL: string | undefined;
		let opts: URLPatternOptions | undefined;

		// Handle empty constructor - create wildcard pattern
		if (input === undefined) {
			input = {};
		}

		if (typeof input === "object") {
			// Object input: second arg is options
			opts = baseURLOrOptions as URLPatternOptions | undefined;
		} else {
			// String input: check if second arg is baseURL (string) or options (object)
			if (typeof baseURLOrOptions === "string") {
				baseURL = baseURLOrOptions;
				opts = options;
			} else if (typeof baseURLOrOptions === "object") {
				// Second arg is options, no baseURL
				opts = baseURLOrOptions;
			}
		}

		this.#ignoreCase = opts?.ignoreCase ?? false;

		// Handle baseURL from object input or parameter
		const base = typeof input === "object" ? input.baseURL : baseURL;
		let baseUrlParsed: URL | undefined;
		if (base) {
			try {
				baseUrlParsed = new URL(base);
			} catch {
				// Invalid baseURL
			}
		}

		if (typeof input === "string") {
			// Parse string pattern with & syntax
			const parsed = parseStringPattern(input);
			this.#originalInput = parsed;

			// Note: Unlike strict URLPattern, we allow pathname-only patterns without baseURL
			// for convenience in routing. e.g., "/users/:id" or "/api&format=:format"

			// Compile protocol pattern
			const protocol = parsed.protocol || (baseUrlParsed ? baseUrlParsed.protocol.replace(":", "") : undefined);
			if (protocol) {
				this.#protocolCompiled = compileComponentPattern(protocol, this.#ignoreCase);
			}

			// Compile hostname pattern
			let hostname = parsed.hostname || (baseUrlParsed ? baseUrlParsed.hostname : undefined);
			if (hostname) {
				// Normalize IPv6 hex digits to lowercase (case-insensitive)
				// Only lowercase literal chars, preserve pattern syntax like :name
				if (hostname.startsWith("[")) {
					hostname = hostname.replace(/[A-F]/g, c => c.toLowerCase());
				} else {
					// Normalize IDN (emoji, unicode) to Punycode if no pattern syntax
					const hasPatternSyntax = /[{}()*+?:|\\]/.test(hostname);
					if (!hasPatternSyntax) {
						hostname = toASCII(hostname);
					}
				}
				this.#hostnameCompiled = compileComponentPattern(hostname, this.#ignoreCase);
			}

			// Compile port pattern if present (including empty string which means "must be empty")
			if (parsed.port !== undefined) {
				let port = parsed.port;
				// Normalize default port if protocol is known
				const hasPatternSyntax = /[{}()*+?:|\\]/.test(port);
				if (protocol && !hasPatternSyntax) {
					const canonicalPort = canonicalizePort(port, true); // throws if invalid
					if (canonicalPort !== undefined) {
						const defaultPort = getDefaultPort(protocol);
						if (defaultPort && canonicalPort === defaultPort) {
							port = "";
						} else {
							port = canonicalPort;
						}
					}
				}
				this.#portCompiled = compileComponentPattern(port, this.#ignoreCase);
			}

			// Compile username pattern if present
			if (parsed.username !== undefined) {
				this.#usernameCompiled = compileComponentPattern(parsed.username, this.#ignoreCase);
			}

			// Compile password pattern if present
			if (parsed.password !== undefined) {
				this.#passwordCompiled = compileComponentPattern(parsed.password, this.#ignoreCase);
			}

			this.#searchPattern = parsed.search;

			// Also compile search as a component pattern for ignoreCase support
			if (parsed.search) {
				this.#searchCompiled = compileComponentPattern(parsed.search, this.#ignoreCase);
			}

			// Compile hash pattern if present
			if (parsed.hash) {
				this.#hashCompiled = compileComponentPattern(parsed.hash, this.#ignoreCase);
			}

			// Resolve pathname - inherit from baseURL if not specified in pattern
			let pathname: string;
			// Note: "protocol" was already defined above for compileProtocolPattern
			const isNonSpecialScheme = protocol && isDefinitelyNonSpecialScheme(protocol);

			if (parsed.pathname !== undefined) {
				pathname = parsed.pathname;
				if (!isNonSpecialScheme && baseUrlParsed && !pathname.startsWith("/")) {
					// Relative path - resolve against base (only for special schemes)
					pathname = "/" + pathname;
				}
			} else if (baseUrlParsed) {
				// Inherit pathname from baseURL
				pathname = baseUrlParsed.pathname;
			} else if (isNonSpecialScheme) {
				// Non-special schemes can have empty pathname
				pathname = "";
			} else {
				// Default to / if no pathname and no baseURL
				pathname = "/";
			}
			// Normalize pathname (resolve . and .. segments)
			// Skip normalization for empty pathname on non-special schemes
			if (pathname !== "") {
				pathname = normalizePathname(pathname);
			}
			// Don't encode the pattern - it contains special syntax like :id
			this.#pathnameCompiled = compilePathname(pathname, true, this.#ignoreCase);
		} else {
			this.#originalInput = input;

			// Compile protocol pattern
			let protocol = input.protocol || (baseUrlParsed ? baseUrlParsed.protocol.replace(":", "") : undefined);
			if (protocol) {
				// Strip trailing colon if present (e.g., "http:" -> "http")
				if (protocol.endsWith(":")) {
					protocol = protocol.slice(0, -1);
				}
				this.#protocolCompiled = compileComponentPattern(protocol, this.#ignoreCase);
			}

			// Compile hostname pattern
			let hostname = input.hostname || (baseUrlParsed ? baseUrlParsed.hostname : undefined);
			if (hostname) {
				// Normalize hostname to Punycode (IDN -> ASCII)
				// Only normalize if it's a literal hostname (no pattern syntax)
				const hasPatternSyntax = /[*+?{}():\[\]\\]/.test(hostname);
				if (!hasPatternSyntax) {
					hostname = toASCII(hostname);
				}
				// Normalize IPv6 hex digits to lowercase (case-insensitive)
				if (hostname.startsWith("[")) {
					hostname = hostname.replace(/[A-F]/g, c => c.toLowerCase());
				}
				this.#hostnameCompiled = compileComponentPattern(hostname, this.#ignoreCase);
			}

			// Compile port pattern
			if (input.port) {
				let port = input.port;
				// Only normalize to default port if it's a literal port value (no pattern syntax)
				// Check if port contains URLPattern special chars
				const hasPatternSyntax = /[{}()*+?:|\\]/.test(port);
				if (protocol && !hasPatternSyntax && isValidPatternPort(port)) {
					// Only canonicalize if port is valid (all digits) - throws if out of range
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
				this.#portCompiled = compileComponentPattern(port, this.#ignoreCase);
			}

			// Compile hash pattern
			if (input.hash) {
				let hash = input.hash;
				// Strip leading # if present (e.g., "#baz" -> "baz")
				if (hash.startsWith("#")) {
					hash = hash.slice(1);
				}
				this.#hashCompiled = compileComponentPattern(hash, this.#ignoreCase);
			}

			// Compile search pattern
			// URLPattern treats search as a component pattern (like pathname), not as key=value pairs
			if (input.search) {
				let search = input.search;
				// Strip leading ? if present (e.g., "?bar" -> "bar")
				if (search.startsWith("?")) {
					search = search.slice(1);
				}
				this.#searchCompiled = compileComponentPattern(search, this.#ignoreCase);
			}

			// Compile username pattern
			if (input.username) {
				this.#usernameCompiled = compileComponentPattern(input.username, this.#ignoreCase);
			}

			// Compile password pattern
			if (input.password) {
				this.#passwordCompiled = compileComponentPattern(input.password, this.#ignoreCase);
			}

			// Resolve relative pathname against baseURL and normalize
			let pathname: string;
			if (input.pathname !== undefined && input.pathname !== "") {
				pathname = input.pathname;
			} else if (baseUrlParsed) {
				// Inherit pathname from baseURL (also when pathname is empty string)
				pathname = baseUrlParsed.pathname;
			} else {
				// URLPattern spec: unspecified pathname defaults to wildcard
				pathname = "*";
			}

			if (baseUrlParsed && pathname && !pathname.startsWith("/")) {
				// Relative path - resolve against base using URL resolution
				try {
					const resolved = new URL(pathname, baseUrlParsed.href);
					pathname = resolved.pathname;
				} catch {
					// If resolution fails, try simple concatenation
					const basePath = baseUrlParsed.pathname;
					// If base ends with /, append; otherwise replace last segment
					if (basePath.endsWith("/")) {
						pathname = basePath + pathname;
					} else {
						pathname = basePath.slice(0, basePath.lastIndexOf("/") + 1) + pathname;
					}
				}
			}

			// Only normalize pathnames that start with /
			// Pathnames without leading / are stored as-is (for non-special schemes or will fail validation during testing)
			if (pathname.startsWith("/")) {
				// Normalize pathname (resolve . and .. segments)
				pathname = normalizePathname(pathname);
			}

			// Determine if pathname should be encoded based on protocol pattern
			// If protocol is definitely non-special (e.g., "javascript", "data"), don't encode
			// If protocol could be special or is not specified, encode
			const shouldEncodePathname = !isDefinitelyNonSpecialScheme(input.protocol);
			this.#pathnameCompiled = compilePathname(pathname, shouldEncodePathname, this.#ignoreCase);
		}
	}

	/**
	 * Test if a URL matches this pattern
	 */
	test(input?: string | URL | {pathname?: string; search?: string; protocol?: string; hostname?: string; port?: string; username?: string; password?: string; hash?: string; baseURL?: string}, baseURL?: string): boolean {
		// Handle undefined input - per URLPattern spec, test() with no args matches empty object
		if (input === undefined) {
			return this.#testComponents({}, baseURL);
		}

		// Handle URLPatternInit object with component-level matching
		if (typeof input === "object" && !(input instanceof URL)) {
			return this.#testComponents(input, baseURL);
		}

		// Handle string and URL inputs by constructing URL
		let url: URL;
		if (typeof input === "string") {
			try {
				url = baseURL ? new URL(input, baseURL) : new URL(input);
			} catch {
				return false;
			}
		} else {
			url = input;
		}

		// Test protocol pattern if specified
		if (this.#protocolCompiled) {
			const protocol = url.protocol.replace(":", "");
			if (!this.#protocolCompiled.regex.test(protocol)) {
				return false;
			}
		}

		// Test hostname pattern if specified
		if (this.#hostnameCompiled) {
			if (!this.#hostnameCompiled.regex.test(url.hostname)) {
				return false;
			}
		}

		// Test port pattern if specified
		if (this.#portCompiled) {
			if (!this.#portCompiled.regex.test(url.port)) {
				return false;
			}
		}

		// Test hash pattern if specified
		if (this.#hashCompiled) {
			const hash = url.hash.replace("#", "");
			if (!this.#hashCompiled.regex.test(hash)) {
				return false;
			}
		}

		// Test pathname
		if (!this.#pathnameCompiled.regex.test(url.pathname)) {
			return false;
		}

		// Test search params if pattern has them
		if (this.#searchPattern) {
			return testSearchParameters(this.#searchPattern, url.searchParams);
		}

		return true;
	}

	/**
	 * Test component-level matching for URLPatternInit objects
	 */
	#testComponents(input: {pathname?: string; search?: string; protocol?: string; hostname?: string; port?: string; username?: string; password?: string; hash?: string; baseURL?: string}, baseURL?: string): boolean {
		// Get baseURL for component inheritance
		const base = input.baseURL || baseURL;
		let baseUrlObj: URL | undefined;
		if (base) {
			try {
				baseUrlObj = new URL(base);
			} catch {
				// Invalid baseURL, but we can still try component matching
			}
		}

		// Validate and test protocol
		const protocol = input.protocol !== undefined
			? input.protocol
			: (baseUrlObj ? baseUrlObj.protocol.replace(":", "") : undefined);

		// If protocol is provided, validate it's a valid URL scheme
		if (protocol !== undefined && !isValidProtocol(protocol)) {
			return false;
		}

		// Test protocol pattern if specified
		if (this.#protocolCompiled) {
			if (protocol === undefined) {
				// Pattern has protocol constraint but input doesn't specify one
				return false;
			}

			if (!this.#protocolCompiled.regex.test(protocol)) {
				return false;
			}
		}

		// Test hostname - inherit from baseURL if not specified
		if (this.#hostnameCompiled) {
			let hostname = input.hostname !== undefined
				? input.hostname
				: (baseUrlObj ? baseUrlObj.hostname : undefined);

			if (hostname === undefined) {
				return false;
			}

			// Normalize hostname (IDN -> Punycode)
			hostname = toASCII(hostname);

			if (!this.#hostnameCompiled.regex.test(hostname)) {
				return false;
			}
		}

		// Canonicalize and test port - inherit from baseURL if not specified
		let port = input.port !== undefined
			? input.port
			: (baseUrlObj ? baseUrlObj.port : undefined);

		// If port is provided, canonicalize it
		if (port !== undefined) {
			const canonicalPort = canonicalizePort(port);
			if (canonicalPort === undefined) {
				return false; // Invalid port
			}
			port = canonicalPort;

			// If port matches the default for the protocol, treat it as empty
			if (protocol) {
				const defaultPort = getDefaultPort(protocol);
				if (defaultPort && port === defaultPort) {
					port = "";
				}
			}
		}

		// Test port pattern if specified
		if (this.#portCompiled) {
			if (port === undefined) {
				return false;
			}

			if (!this.#portCompiled.regex.test(port)) {
				return false;
			}
		}

		// Test username pattern if specified
		if (this.#usernameCompiled) {
			let username = input.username !== undefined
				? input.username
				: (baseUrlObj ? baseUrlObj.username : undefined);

			if (username === undefined) {
				return false;
			}

			// Percent-encode username for canonical comparison
			// Note: Encoding is case-sensitive - %c3 != %C3
			username = encodeURIComponent(username);

			if (!this.#usernameCompiled.regex.test(username)) {
				return false;
			}
		}

		// Test password pattern if specified
		if (this.#passwordCompiled) {
			let password = input.password !== undefined
				? input.password
				: (baseUrlObj ? baseUrlObj.password : undefined);

			if (password === undefined) {
				return false;
			}

			// Percent-encode password for canonical comparison
			// Note: Encoding is case-sensitive - %c3 != %C3
			password = encodeURIComponent(password);

			if (!this.#passwordCompiled.regex.test(password)) {
				return false;
			}
		}

		// Test pathname - inherit from baseURL if not specified
		let pathname = input.pathname !== undefined
			? input.pathname
			: (baseUrlObj ? baseUrlObj.pathname : undefined);

		if (pathname === undefined) {
			pathname = "/";
		}

		// Validate pathname must start with / for special schemes only
		// Non-special schemes (data:, javascript:, mailto:, etc.) allow arbitrary pathnames
		if (input.pathname !== undefined && !input.pathname.startsWith("/")) {
			// If there's a baseURL, resolve relative pathname against it
			if (baseUrlObj) {
				// Resolve relative path against baseURL
				try {
					const resolved = new URL(input.pathname, baseUrlObj.href);
					pathname = resolved.pathname;
				} catch {
					// If resolution fails, use as-is
				}
			} else if (protocol && isSpecialScheme(protocol)) {
				// Special scheme without baseURL requires leading /
				return false;
			}
		}

		// Normalize pathname (resolve . and .. segments) for proper comparison
		// Both pattern and input should be normalized
		if (pathname.startsWith("/")) {
			pathname = normalizePathname(pathname);
		}

		// Percent-encode pathname for canonical comparison
		// If no protocol is specified, assume special scheme (default)
		// If protocol is specified and non-special, don't encode
		const shouldEncode = !protocol || isSpecialScheme(protocol);
		if (shouldEncode) {
			pathname = encodePathname(pathname);
		}

		if (!this.#pathnameCompiled.regex.test(pathname)) {
			return false;
		}

		// Test hash - inherit from baseURL if not specified
		if (this.#hashCompiled) {
			let hash = input.hash !== undefined
				? (input.hash.startsWith("#") ? input.hash.slice(1) : input.hash)
				: (baseUrlObj && baseUrlObj.hash ? baseUrlObj.hash.replace("#", "") : undefined);

			if (hash === undefined) {
				return false;
			}

			// Percent-encode hash for canonical comparison
			hash = encodeHash(hash);

			if (!this.#hashCompiled.regex.test(hash)) {
				return false;
			}
		}

		// Test search pattern if specified (URLPattern spec: search is a component pattern)
		if (this.#searchCompiled) {
			let search = input.search !== undefined
				? input.search
				: (baseUrlObj && baseUrlObj.search ? baseUrlObj.search.replace("?", "") : undefined);

			if (search === undefined) {
				// Default to empty string if no search specified
				search = "";
			}

			// Percent-encode search for canonical comparison
			search = encodeSearch(search);

			if (!this.#searchCompiled.regex.test(search)) {
				return false;
			}
		} else if (this.#searchPattern) {
			// Legacy: & syntax search params (only if #searchCompiled not set)
			let search = input.search !== undefined
				? input.search
				: (baseUrlObj && baseUrlObj.search ? baseUrlObj.search.replace("?", "") : undefined);

			if (search === undefined) {
				return false;
			}

			// Don't encode search - URLSearchParams handles encoding/decoding internally
			// Convert search string to URLSearchParams
			const searchParams = new URLSearchParams(search);
			return testSearchParameters(this.#searchPattern, searchParams);
		}

		return true;
	}

	/**
	 * Execute pattern with component-level extraction for URLPatternInit objects
	 */
	#execComponents(input: {pathname?: string; search?: string; protocol?: string; hostname?: string; port?: string; username?: string; password?: string; hash?: string; baseURL?: string}, baseURL?: string): MatchPatternResult {
		// Get baseURL for component inheritance
		const base = input.baseURL || baseURL;
		let baseUrlObj: URL | undefined;
		if (base) {
			try {
				baseUrlObj = new URL(base);
			} catch {
				// Invalid baseURL
			}
		}

		// Extract pathname
		let pathname = input.pathname !== undefined
			? input.pathname
			: (baseUrlObj ? baseUrlObj.pathname : "/");

		// Normalize pathname (resolve . and .. segments)
		pathname = normalizePathname(pathname);
		// TODO: Add percent encoding for canonical comparison
		// pathname = encodePathname(pathname);

		const pathnameMatch = this.#pathnameCompiled.regex.exec(pathname);
		const params: Record<string, string> = {};
		const pathnameGroups: Record<string, string> = {};

		if (pathnameMatch) {
			for (let i = 0; i < this.#pathnameCompiled.paramNames.length; i++) {
				const name = this.#pathnameCompiled.paramNames[i];
				const value = pathnameMatch[i + 1];
				// URLPattern spec: undefined for unmatched optional/zero-or-more groups
				if (value !== undefined) {
					params[name] = value;
					pathnameGroups[name] = value;
				}
			}
		}

		// Extract search params
		const searchGroups: Record<string, string> = {};
		if (this.#searchPattern) {
			const search = input.search !== undefined
				? input.search
				: (baseUrlObj && baseUrlObj.search ? baseUrlObj.search.replace("?", "") : "");

			const searchParams = new URLSearchParams(search);
			const extracted = extractSearchParams(this.#searchPattern, searchParams);
			Object.assign(params, extracted);
			Object.assign(searchGroups, extracted);
		} else if (input.search || (baseUrlObj && baseUrlObj.search)) {
			const search = input.search || (baseUrlObj?.search.replace("?", "") || "");
			const searchParams = new URLSearchParams(search);
			for (const [key, value] of searchParams) {
				params[key] = value;
				searchGroups[key] = value;
			}
		}

		// Get final component values for result
		const protocol = input.protocol !== undefined
			? input.protocol
			: (baseUrlObj ? baseUrlObj.protocol.replace(":", "") : "");
		const hostname = input.hostname !== undefined
			? input.hostname
			: (baseUrlObj ? baseUrlObj.hostname : "");
		let port = input.port !== undefined
			? input.port
			: (baseUrlObj ? baseUrlObj.port : "");
		// Canonicalize port
		if (port) {
			port = canonicalizePort(port) || "";
		}
		const hash = input.hash !== undefined
			? input.hash
			: (baseUrlObj && baseUrlObj.hash ? baseUrlObj.hash.replace("#", "") : "");
		const search = input.search !== undefined
			? input.search
			: (baseUrlObj && baseUrlObj.search ? baseUrlObj.search.replace("?", "") : "");

		return {
			params,
			pathname: {
				input: pathname,
				groups: pathnameGroups,
			},
			search: {
				input: search ? `?${search}` : "",
				groups: searchGroups,
			},
			protocol: {
				input: protocol ? `${protocol}:` : "",
				groups: {},
			},
			hostname: {
				input: hostname,
				groups: {},
			},
			port: {
				input: port,
				groups: {},
			},
			username: {
				input: "",
				groups: {},
			},
			password: {
				input: "",
				groups: {},
			},
			hash: {
				input: hash ? `#${hash}` : "",
				groups: {},
			},
			inputs: [input],
		};
	}

	/**
	 * Execute pattern and extract parameters
	 */
	exec(input: string | URL | {pathname?: string; search?: string; protocol?: string; hostname?: string; port?: string; username?: string; password?: string; hash?: string; baseURL?: string}, baseURL?: string): MatchPatternResult | null {
		if (!this.test(input, baseURL)) {
			return null;
		}

		// Handle URLPatternInit object with component-level extraction
		if (typeof input === "object" && !(input instanceof URL)) {
			return this.#execComponents(input, baseURL);
		}

		// Handle string and URL inputs by constructing URL
		let url: URL;
		if (typeof input === "string") {
			url = baseURL ? new URL(input, baseURL) : new URL(input);
		} else {
			url = input;
		}

		// Match pathname
		const match = this.#pathnameCompiled.regex.exec(url.pathname);
		if (!match) {
			return null;
		}

		// Extract pathname params
		const params: Record<string, string> = {};
		const pathnameGroups: Record<string, string> = {};

		for (let i = 0; i < this.#pathnameCompiled.paramNames.length; i++) {
			const name = this.#pathnameCompiled.paramNames[i];
			const value = match[i + 1];
			// URLPattern spec: undefined for unmatched optional/zero-or-more groups
			if (value !== undefined) {
				params[name] = value;
				pathnameGroups[name] = value;
			}
		}

		// Extract search params
		const searchGroups: Record<string, string> = {};
		if (this.#searchPattern) {
			const searchParams = extractSearchParams(
				this.#searchPattern,
				url.searchParams,
			);
			Object.assign(params, searchParams);
			Object.assign(searchGroups, searchParams);
		} else {
			// Capture all search params even without pattern
			for (const [key, value] of url.searchParams) {
				params[key] = value;
				searchGroups[key] = value;
			}
		}

		return {
			params,
			pathname: {
				input: url.pathname,
				groups: pathnameGroups,
			},
			search: {
				input: url.search,
				groups: searchGroups,
			},
			protocol: {
				input: url.protocol,
				groups: {},
			},
			hostname: {
				input: url.hostname,
				groups: {},
			},
			port: {
				input: url.port,
				groups: {},
			},
			username: {
				input: url.username,
				groups: {},
			},
			password: {
				input: url.password,
				groups: {},
			},
			hash: {
				input: url.hash,
				groups: {},
			},
			inputs: [input],
		};
	}
}

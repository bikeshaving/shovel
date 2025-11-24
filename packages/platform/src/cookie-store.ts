/**
 * Cookie Store API Implementation
 * https://cookiestore.spec.whatwg.org/
 *
 * Provides asynchronous cookie management for ServiceWorker contexts
 */

// ============================================================================
// TYPES (extending global DOM types to match WHATWG spec)
// ============================================================================

// Extend the incomplete global CookieListItem with missing properties
// TypeScript's lib.dom.d.ts only has name? and value?, but the spec includes all cookie attributes
declare global {
	interface CookieListItem {
		domain?: string;
		path?: string;
		expires?: number;
		secure?: boolean;
		sameSite?: CookieSameSite;
		partitioned?: boolean;
	}
}

// Create and export local type aliases that reference the (now-complete) global types
// This makes them importable from this module while using the standard lib.dom.d.ts definitions
export type CookieSameSite = globalThis.CookieSameSite;
export type CookieInit = globalThis.CookieInit;
export type CookieStoreGetOptions = globalThis.CookieStoreGetOptions;
export type CookieStoreDeleteOptions = globalThis.CookieStoreDeleteOptions;
export type CookieListItem = globalThis.CookieListItem;
export type CookieList = CookieListItem[];

// ============================================================================
// COOKIE PARSING UTILITIES
// ============================================================================

/**
 * Parse Cookie header value into key-value pairs
 * Cookie: name=value; name2=value2
 */
export function parseCookieHeader(cookieHeader: string): Map<string, string> {
	const cookies = new Map<string, string>();

	if (!cookieHeader) return cookies;

	const pairs = cookieHeader.split(/;\s*/);
	for (const pair of pairs) {
		const [name, ...valueParts] = pair.split("=");
		if (name) {
			const value = valueParts.join("="); // Handle values with = in them
			cookies.set(name.trim(), decodeURIComponent(value || ""));
		}
	}

	return cookies;
}

/**
 * Serialize cookie into Set-Cookie header value
 */
export function serializeCookie(cookie: CookieInit): string {
	let header = `${encodeURIComponent(cookie.name)}=${encodeURIComponent(cookie.value)}`;

	if (cookie.expires !== undefined && cookie.expires !== null) {
		const date = new Date(cookie.expires);
		header += `; Expires=${date.toUTCString()}`;
	}

	if (cookie.domain) {
		header += `; Domain=${cookie.domain}`;
	}

	if (cookie.path) {
		header += `; Path=${cookie.path}`;
	} else {
		header += `; Path=/`;
	}

	if (cookie.sameSite) {
		header += `; SameSite=${cookie.sameSite.charAt(0).toUpperCase() + cookie.sameSite.slice(1)}`;
	} else {
		header += `; SameSite=Strict`;
	}

	if (cookie.partitioned) {
		header += `; Partitioned`;
	}

	// Secure is implied for all cookies in this implementation
	header += `; Secure`;

	return header;
}

/**
 * Parse Set-Cookie header into CookieListItem
 */
export function parseSetCookieHeader(setCookieHeader: string): CookieListItem {
	const parts = setCookieHeader.split(/;\s*/);
	const [nameValue, ...attributes] = parts;
	const [name, ...valueParts] = nameValue.split("=");
	const value = valueParts.join("=");

	const cookie: CookieListItem = {
		name: decodeURIComponent(name.trim()),
		value: decodeURIComponent(value || ""),
	};

	for (const attr of attributes) {
		const [key, ...attrValueParts] = attr.split("=");
		const attrKey = key.trim().toLowerCase();
		const attrValue = attrValueParts.join("=").trim();

		switch (attrKey) {
			case "expires":
				cookie.expires = new Date(attrValue).getTime();
				break;
			case "max-age":
				cookie.expires = Date.now() + parseInt(attrValue, 10) * 1000;
				break;
			case "domain":
				cookie.domain = attrValue;
				break;
			case "path":
				cookie.path = attrValue;
				break;
			case "secure":
				cookie.secure = true;
				break;
			case "samesite":
				cookie.sameSite = attrValue.toLowerCase() as CookieSameSite;
				break;
			case "partitioned":
				cookie.partitioned = true;
				break;
		}
	}

	return cookie;
}

// ============================================================================
// COOKIE STORE IMPLEMENTATION
// ============================================================================

/**
 * RequestCookieStore - Cookie Store implementation for ServiceWorker contexts
 *
 * This implementation:
 * - Reads cookies from the incoming Request's Cookie header
 * - Tracks changes (set/delete operations)
 * - Exports changes as Set-Cookie headers for the Response
 *
 * It follows the Cookie Store API spec but is designed for server-side
 * request handling rather than browser contexts.
 */
export class RequestCookieStore extends EventTarget {
	#cookies: Map<string, CookieListItem>;
	#changes: Map<string, CookieInit | null>; // null = deleted
	#request: Request | null;

	// Event handler for cookie changes (spec compliance)
	// eslint-disable-next-line no-restricted-syntax
	onchange: ((this: RequestCookieStore, ev: Event) => any) | null = null;

	constructor(request?: Request) {
		super();
		this.#cookies = new Map();
		this.#changes = new Map();
		this.#request = request || null;

		// Parse initial cookies from request
		if (request) {
			const cookieHeader = request.headers.get("cookie");
			if (cookieHeader) {
				const parsed = parseCookieHeader(cookieHeader);
				for (const [name, value] of parsed) {
					this.#cookies.set(name, {name, value});
				}
			}
		}
	}

	/**
	 * Get a single cookie by name
	 */
	async get(
		nameOrOptions: string | CookieStoreGetOptions,
	): Promise<CookieListItem | null> {
		const name =
			typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions.name;

		if (!name) {
			throw new TypeError("Cookie name is required");
		}

		// Check changes first (for set/delete operations)
		if (this.#changes.has(name)) {
			const change = this.#changes.get(name);
			if (change === null || change === undefined) return null; // Deleted or undefined
			return {
				name: change.name,
				value: change.value,
				domain: change.domain ?? undefined,
				path: change.path,
				expires: change.expires ?? undefined,
				sameSite: change.sameSite,
				partitioned: change.partitioned,
			};
		}

		// Return from original cookies
		return this.#cookies.get(name) || null;
	}

	/**
	 * Get all cookies matching the filter
	 */
	async getAll(
		nameOrOptions?: string | CookieStoreGetOptions,
	): Promise<CookieList> {
		const name =
			typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions?.name;

		const result: CookieList = [];

		// Collect all cookies (original + changes)
		const allNames = new Set([
			...this.#cookies.keys(),
			...this.#changes.keys(),
		]);

		for (const cookieName of allNames) {
			// Skip if filtering by name and doesn't match
			if (name && cookieName !== name) continue;

			// Check if deleted
			if (
				this.#changes.has(cookieName) &&
				this.#changes.get(cookieName) === null
			) {
				continue;
			}

			// Get cookie (prefer changes over original)
			const cookie = await this.get(cookieName);
			if (cookie) {
				result.push(cookie);
			}
		}

		return result;
	}

	/**
	 * Set a cookie
	 */
	async set(nameOrOptions: string | CookieInit, value?: string): Promise<void> {
		let cookie: CookieInit;

		if (typeof nameOrOptions === "string") {
			if (value === undefined) {
				throw new TypeError("Cookie value is required");
			}
			cookie = {
				name: nameOrOptions,
				value,
				path: "/",
				sameSite: "strict",
			};
		} else {
			cookie = {
				path: "/",
				sameSite: "strict",
				...nameOrOptions,
			};
		}

		// Validate cookie size (spec: 4096 bytes combined)
		const size = cookie.name.length + cookie.value.length;
		if (size > 4096) {
			throw new TypeError(
				`Cookie name+value too large: ${size} bytes (max 4096)`,
			);
		}

		// Record the change
		this.#changes.set(cookie.name, cookie);
	}

	/**
	 * Delete a cookie
	 */
	async delete(
		nameOrOptions: string | CookieStoreDeleteOptions,
	): Promise<void> {
		const name =
			typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions.name;

		if (!name) {
			throw new TypeError("Cookie name is required");
		}

		// Record deletion
		this.#changes.set(name, null);
	}

	/**
	 * Get Set-Cookie headers for all changes
	 * This should be called when constructing the Response
	 */
	getSetCookieHeaders(): string[] {
		const headers: string[] = [];

		for (const [name, change] of this.#changes) {
			if (change === null) {
				// Delete cookie by setting expires to past date
				headers.push(
					serializeCookie({
						name,
						value: "",
						expires: 0,
						path: "/",
					}),
				);
			} else {
				headers.push(serializeCookie(change));
			}
		}

		return headers;
	}

	/**
	 * Check if there are any pending changes
	 */
	hasChanges(): boolean {
		return this.#changes.size > 0;
	}

	/**
	 * Clear all pending changes (for testing/reset)
	 */
	clearChanges(): void {
		this.#changes.clear();
	}
}

/** @b9g/router - Universal request router built on web standards */

import {
	MatchPattern,
	isSimplePattern,
	compilePathname,
	type CompiledPattern,
} from "@b9g/match-pattern";
import {
	HTTPError,
	isHTTPError,
	InternalServerError,
	NotFound,
} from "@b9g/http-errors";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["shovel", "router"]);

// ============================================================================
// TYPES
// ============================================================================

/**
 * Context object passed to handlers and middleware
 * Contains route parameters extracted from URL pattern matching
 * Augmentable via module declaration for middleware-specific properties
 */
export interface RouteContext {
	/** Route parameters extracted from URL pattern matching */
	params: Record<string, string>;
	/** Allow middleware to add arbitrary properties to context */
	[key: string]: unknown;
}

/**
 * Handler function signature - terminal response producer
 * Handlers are terminal - must return a Response
 */
export type Handler = (
	request: Request,
	context: RouteContext,
) => Response | Promise<Response>;

/**
 * Function middleware signature
 * Can modify request and context, and can return a Response to short-circuit
 */
export type FunctionMiddleware = (
	request: Request,
	context: RouteContext,
) =>
	| Response
	| null
	| undefined
	| void
	| Promise<Response | null | undefined | void>;

/**
 * Generator middleware signature - uses yield for continuation.
 * Yield to pass control to the next middleware/handler, receive Response back.
 * Optionally yield a modified Request (or yield without value to use original).
 */
export type GeneratorMiddleware = (
	request: Request,
	context: RouteContext,
) =>
	| Generator<Request | undefined, Response | null | undefined | void, Response>
	| AsyncGenerator<
			Request | undefined,
			Response | null | undefined | void,
			Response
	  >;

/**
 * Union type for all supported middleware types
 * Framework automatically detects type and executes appropriately
 */
export type Middleware = GeneratorMiddleware | FunctionMiddleware;

/**
 * HTTP methods supported by the router
 */
export type HTTPMethod =
	| "GET"
	| "POST"
	| "PUT"
	| "DELETE"
	| "PATCH"
	| "HEAD"
	| "OPTIONS";

/**
 * Route options for configuring route metadata
 * Augmentable via module declaration for custom metadata
 */
export interface RouteOptions {
	/** Optional name for the route, useful for matching/identification */
	name?: string;
	/**
	 * Set to false to leave the route out of `toJSON()`, so its pattern and
	 * name do not reach the client. The route works as usual on the server.
	 */
	serialize?: boolean;
}

/**
 * Options for `router.mount()`
 */
export interface MountOptions {
	/**
	 * Set to false to leave all of the subrouter's routes and redirects out
	 * of `toJSON()`.
	 */
	serialize?: boolean;
}

/**
 * Options for a Router
 */
export interface RouterOptions {
	/**
	 * Longest pathname the router will match, in characters. Longer requests
	 * get 414 URI Too Long before any matching, which caps how long a
	 * backtracking-prone pattern can take. Defaults to 2048; Infinity
	 * disables the limit.
	 */
	maxPathLength?: number;
}

/**
 * Result of matching a URL against registered routes
 */
export interface RouteMatch {
	/** Route parameters extracted from URL pattern matching */
	params: Record<string, string>;
	/** HTTP methods registered for this pattern */
	methods: string[];
	/** Route name if provided */
	name?: string;
	/** Original pattern string */
	pattern: string;
}

/** A redirect the router would send for a URL */
export interface RedirectResolution {
	/** The absolute URL to go to */
	location: string;
	status: number;
}

/**
 * What `router.resolve()` found for a URL: a redirect or a matching route
 */
export type Resolution =
	| {redirect: RedirectResolution; route?: undefined}
	| {route: RouteMatch; redirect?: undefined};

/**
 * A route in the serialized form: one pattern/method pair with an optional
 * name. Handlers are never serialized — the client matches, the server handles.
 */
interface SerializedRoute {
	pattern: string;
	method: string;
	name?: string;
}

/**
 * One entry in the serialized router, tagged by which key is present. Entries
 * are stored in declaration order, so the exact route/redirect interleaving
 * (which decides precedence) survives a round-trip.
 */
type SerializedEntry = {route: SerializedRoute} | {redirect: RedirectEntry};

/**
 * A redirect as serializable data. Two matcher flavors, both of which
 * serialize to plain strings and recompile identically on each side:
 * - MatchPattern syntax: `{pattern}` with `:name` groups, `:name` in `target`.
 *   With `scope` (set when registered under a path prefix), it only matches
 *   paths under `scope`.
 * - Raw regexp: `{source, flags}`, with `$1`…`$n` in `target`. With `base`
 *   (set when a subrouter is mounted), the regexp only sees paths under
 *   `base`, with `base` removed; the bare `base` path reads as `/`.
 *
 * A `fallback` redirect only applies when the request would otherwise be a
 * 404, wherever it was declared.
 */
interface RedirectEntry {
	match:
		| {pattern: string; scope?: string}
		| {source: string; flags: string; base?: string};
	target: string;
	status: number;
	fallback?: true;
}

/**
 * Options for `redirect()` and `router.redirect()`
 */
export interface RedirectOptions {
	/** Response status (default: 301) */
	status?: number;
	/**
	 * Only redirect when the request would otherwise be a 404: the rest of
	 * the chain runs first. Without it, a redirect answers before any route.
	 */
	fallback?: boolean;
}

/**
 * The serializable form of a Router's match table, produced by `toJSON()` and
 * consumed by `Router.fromJSON()`. One value drives the client router,
 * static-route enumeration, and app self-documentation. `format` is the
 * version of this JSON shape, not of the routes it describes.
 */
interface SerializedRouter {
	format: 1;
	entries: SerializedEntry[];
}

/**
 * Route entry stored by the router
 */
export interface RouteEntry {
	pattern: import("@b9g/match-pattern").MatchPattern;
	method: string;
	handler?: Handler;
	name?: string;
	middlewares: Middleware[];
}

/**
 * Internal middleware entry stored by the router
 */
export interface MiddlewareEntry {
	middleware: Middleware;
	/** If set, middleware only runs for paths matching this prefix */
	pathPrefix?: string;
}

/**
 * Result of internal route matching (for handle)
 */
interface InternalMatchResult {
	handler?: Handler;
	context: RouteContext;
	entry: RouteEntry;
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Radix tree node for fast route matching
 * Supports static segments, named parameters, and wildcards
 */
class RadixNode {
	children: Map<string, RadixNode>; // char -> RadixNode
	routes: Map<string, RouteEntry>; // method -> RouteEntry
	paramName: string | null; // param name if this is a :param segment
	paramChild: RadixNode | null; // child node for :param
	wildcardChild: RadixNode | null; // child node for * wildcard

	constructor() {
		this.children = new Map();
		this.routes = new Map();
		this.paramName = null;
		this.paramChild = null;
		this.wildcardChild = null;
	}
}

/**
 * Route entry for complex patterns that need regex matching
 */
interface ComplexRouteEntry {
	compiled: CompiledPattern;
	route: RouteEntry;
}

/**
 * RadixTreeExecutor uses a radix tree for simple patterns and falls back
 * to regex matching for complex patterns (constraints, modifiers, etc.)
 *
 * Simple patterns: /users/:id, /api/health, /files/*
 * Complex patterns: /users/:id(\d+), /files/:path+, {/prefix}?/users
 */
class RadixTreeExecutor {
	#root: RadixNode;
	#complexRoutes: ComplexRouteEntry[];

	constructor(routes: RouteEntry[]) {
		this.#root = new RadixNode();
		this.#complexRoutes = [];
		for (const route of routes) {
			const pathname = route.pattern.pathname;

			if (isSimplePattern(pathname)) {
				// Simple pattern - add to radix tree
				this.#addToTree(pathname, route);
			} else {
				// Complex pattern - compile to regex
				const compiled = compilePathname(pathname);
				this.#complexRoutes.push({compiled, route});
			}
		}
	}

	/**
	 * Add a simple pattern to the radix tree
	 */
	#addToTree(pathname: string, route: RouteEntry): void {
		let node = this.#root;
		let i = 0;

		while (i < pathname.length) {
			const char = pathname[i];

			if (char === ":") {
				// Named parameter - find the param name
				const match = pathname.slice(i).match(/^:(\w+)/);
				if (match) {
					const paramName = match[1];

					if (!node.paramChild) {
						node.paramChild = new RadixNode();
						node.paramChild.paramName = paramName;
					}
					node = node.paramChild;
					i += match[0].length;
					continue;
				}
			}

			if (char === "*") {
				// Wildcard - matches rest of path
				if (!node.wildcardChild) {
					node.wildcardChild = new RadixNode();
				}
				node = node.wildcardChild;
				break; // Wildcard consumes everything
			}

			// Static character
			if (!node.children.has(char)) {
				node.children.set(char, new RadixNode());
			}
			node = node.children.get(char)!;
			i++;
		}

		node.routes.set(route.method, route);
	}

	/**
	 * Match a pathname against the radix tree (for URL matching)
	 */
	#matchTreeByPath(
		pathname: string,
	): {node: RadixNode; params: Record<string, string>} | null {
		const params: Record<string, string> = {};
		let node = this.#root;
		let i = 0;

		// Handle empty pathname
		if (!pathname) {
			return node.routes.size > 0 ? {node, params} : null;
		}

		while (i < pathname.length) {
			const char = pathname[i];

			// Try static match first
			if (node.children.has(char)) {
				node = node.children.get(char)!;
				i++;
				continue;
			}

			// Try param match
			if (node.paramChild) {
				// Find end of segment (next / or end of string)
				let j = i;
				while (j < pathname.length && pathname[j] !== "/") {
					j++;
				}

				const value = pathname.slice(i, j);
				if (value) {
					// Non-empty segment
					params[node.paramChild.paramName!] = value;
					node = node.paramChild;
					i = j;
					continue;
				}
			}

			// Try wildcard match
			if (node.wildcardChild) {
				// Wildcard captures rest of path (without leading /)
				const rest = pathname.slice(i);
				params["0"] = rest; // Use "0" as wildcard param name
				node = node.wildcardChild;
				break;
			}

			// No match
			return null;
		}

		// Check if this node has any routes or a wildcard child with routes
		if (node.routes.size > 0) {
			return {node, params};
		}

		// Check wildcard at terminal node (for patterns like /files/*)
		if (node.wildcardChild && node.wildcardChild.routes.size > 0) {
			params["0"] = ""; // Empty wildcard match
			return {node: node.wildcardChild, params};
		}

		return null;
	}

	/**
	 * Match a pathname against the radix tree (for request handling with method)
	 */
	#matchTree(
		pathname: string,
		method: string,
	): {entry: RouteEntry; params: Record<string, string>} | null {
		const result = this.#matchTreeByPath(pathname);
		if (!result) return null;

		const {node, params} = result;
		let entry = node.routes.get(method);
		// HEAD requests should fall back to GET handler (RFC 7231)
		if (!entry && method === "HEAD") {
			entry = node.routes.get("GET");
		}
		if (entry) {
			return {entry, params};
		}

		return null;
	}

	/**
	 * Match a URL against registered routes (returns RouteMatch info)
	 */
	matchURL(url: string | URL): RouteMatch | null {
		const urlObj =
			typeof url === "string" ? new URL(url, "http://localhost") : url;
		const pathname = urlObj.pathname;

		// Try radix tree first (fast path for simple routes)
		const treeResult = this.#matchTreeByPath(pathname);
		if (treeResult) {
			const {node, params} = treeResult;
			const methods = Array.from(node.routes.keys());
			// Get name from first route entry (all entries for same pattern should have same name)
			const firstEntry = node.routes.values().next().value;
			return {
				params,
				methods,
				name: firstEntry?.name,
				pattern: firstEntry?.pattern.pathname ?? "",
			};
		}

		// Fall back to regex for complex routes
		for (const {compiled, route} of this.#complexRoutes) {
			const match = pathname.match(compiled.regex);
			if (match) {
				const params: Record<string, string> = {};
				for (let i = 0; i < compiled.paramNames.length; i++) {
					if (match[i + 1] !== undefined) {
						params[compiled.paramNames[i]] = match[i + 1];
					}
				}
				// Collect all methods for this pattern
				const methods = this.#complexRoutes
					.filter((r) => r.route.pattern.pathname === route.pattern.pathname)
					.map((r) => r.route.method);
				return {
					params,
					methods,
					name: route.name,
					pattern: route.pattern.pathname,
				};
			}
		}

		return null;
	}

	/**
	 * Find the first route that matches the request (for handling)
	 */
	matchRequest(request: Request): InternalMatchResult | null {
		return this.matchPath(new URL(request.url).pathname, request.method);
	}

	/**
	 * Find the first route that matches a pathname and method
	 */
	matchPath(pathname: string, method: string): InternalMatchResult | null {
		method = method.toUpperCase();

		// Try radix tree first (fast path for simple routes)
		const treeResult = this.#matchTree(pathname, method);
		if (treeResult) {
			return {
				handler: treeResult.entry.handler,
				context: {params: treeResult.params},
				entry: treeResult.entry,
			};
		}

		// Fall back to regex for complex routes
		for (const {compiled, route} of this.#complexRoutes) {
			// HEAD requests should fall back to GET handler (RFC 7231)
			const methodMatches =
				route.method === method ||
				(method === "HEAD" && route.method === "GET");
			if (!methodMatches) {
				continue;
			}

			const match = pathname.match(compiled.regex);
			if (match) {
				const params: Record<string, string> = {};
				for (let i = 0; i < compiled.paramNames.length; i++) {
					if (match[i + 1] !== undefined) {
						params[compiled.paramNames[i]] = match[i + 1];
					}
				}
				return {
					handler: route.handler,
					context: {params},
					entry: route,
				};
			}
		}

		return null;
	}
}

/**
 * RouteBuilder provides a chainable API for defining routes with multiple HTTP methods
 *
 * Example:
 *   router.route('/api/users/:id', { name: 'user' })
 *     .use(authMiddleware)
 *     .get(getUserHandler)
 *     .put(updateUserHandler)
 *     .delete(deleteUserHandler);
 */
export class RouteBuilder {
	#router: Router;
	#pattern: string;
	#name?: string;
	#serialize: boolean;
	#middlewares: Middleware[];

	constructor(router: Router, pattern: string, options?: RouteOptions) {
		this.#router = router;
		this.#pattern = pattern;
		this.#name = options?.name;
		this.#serialize = options?.serialize !== false;
		this.#middlewares = [];
	}

	/**
	 * Add route-scoped middleware that only runs when this pattern matches
	 */
	use(middleware: Middleware): RouteBuilder {
		this.#middlewares.push(middleware);
		return this;
	}

	/**
	 * Register a GET handler for this route pattern
	 */
	get(handler?: Handler): RouteBuilder {
		this.#router.addRoute(
			"GET",
			this.#pattern,
			handler,
			this.#name,
			this.#middlewares,
			this.#serialize,
		);
		return this;
	}

	/**
	 * Register a POST handler for this route pattern
	 */
	post(handler?: Handler): RouteBuilder {
		this.#router.addRoute(
			"POST",
			this.#pattern,
			handler,
			this.#name,
			this.#middlewares,
			this.#serialize,
		);
		return this;
	}

	/**
	 * Register a PUT handler for this route pattern
	 */
	put(handler?: Handler): RouteBuilder {
		this.#router.addRoute(
			"PUT",
			this.#pattern,
			handler,
			this.#name,
			this.#middlewares,
			this.#serialize,
		);
		return this;
	}

	/**
	 * Register a DELETE handler for this route pattern
	 */
	delete(handler?: Handler): RouteBuilder {
		this.#router.addRoute(
			"DELETE",
			this.#pattern,
			handler,
			this.#name,
			this.#middlewares,
			this.#serialize,
		);
		return this;
	}

	/**
	 * Register a PATCH handler for this route pattern
	 */
	patch(handler?: Handler): RouteBuilder {
		this.#router.addRoute(
			"PATCH",
			this.#pattern,
			handler,
			this.#name,
			this.#middlewares,
			this.#serialize,
		);
		return this;
	}

	/**
	 * Register a HEAD handler for this route pattern
	 */
	head(handler?: Handler): RouteBuilder {
		this.#router.addRoute(
			"HEAD",
			this.#pattern,
			handler,
			this.#name,
			this.#middlewares,
			this.#serialize,
		);
		return this;
	}

	/**
	 * Register an OPTIONS handler for this route pattern
	 */
	options(handler?: Handler): RouteBuilder {
		this.#router.addRoute(
			"OPTIONS",
			this.#pattern,
			handler,
			this.#name,
			this.#middlewares,
			this.#serialize,
		);
		return this;
	}

	/**
	 * Register a handler for all HTTP methods on this route pattern
	 */
	all(handler?: Handler): RouteBuilder {
		const methods: HTTPMethod[] = [
			"GET",
			"POST",
			"PUT",
			"DELETE",
			"PATCH",
			"HEAD",
			"OPTIONS",
		];
		methods.forEach((method) => {
			this.#router.addRoute(
				method,
				this.#pattern,
				handler,
				this.#name,
				this.#middlewares,
				this.#serialize,
			);
		});
		return this;
	}
}

type RedirectMatcher =
	| {kind: "pattern"; mp: MatchPattern; scope?: string}
	| {kind: "regexp"; re: RegExp; base?: string};

interface RedirectRecord {
	entry: RedirectEntry;
	matcher: RedirectMatcher;
	order: number;
}

/**
 * What is waiting for the response on its way back up the middleware chain:
 * a generator middleware that yielded, or a fallback redirect. A fallback
 * redirect holds a place in the chain like a generator would, and redirects
 * if the response that reaches it is a 404, thrown or returned.
 */
type PendingMiddleware =
	| {generator: ReturnType<GeneratorMiddleware>; fallback?: undefined}
	| {fallback: RedirectRecord; generator?: undefined};

function compileRedirect(entry: RedirectEntry, order: number): RedirectRecord {
	checkTargetOrigin(entry);
	const matcher: RedirectMatcher =
		"pattern" in entry.match
			? {
					kind: "pattern",
					mp: new MatchPattern(entry.match.pattern),
					scope: entry.match.scope,
				}
			: {
					kind: "regexp",
					re: new RegExp(
						entry.match.source,
						entry.match.flags.replace(/[gy]/g, ""),
					),
					base: entry.match.base,
				};
	return {entry, matcher, order};
}

/** How many of its own redirects the router follows looking for a loop. */
const MAX_REDIRECT_HOPS = 8;

const redirectEntries = new WeakMap<Middleware, RedirectEntry>();

function toRedirectEntry(
	from: string | RegExp,
	to: string,
	options: RedirectOptions,
): RedirectEntry {
	return {
		match:
			typeof from === "string"
				? {pattern: from}
				: {source: from.source, flags: from.flags},
		target: to,
		status: options.status ?? 301,
		...(options.fallback ? {fallback: true as const} : {}),
	};
}

/**
 * Where `record` redirects `u`, or null if it does not match. The request's
 * query carries over unless the target sets its own.
 */
function redirectLocation(record: RedirectRecord, u: URL): string | null {
	const {entry, matcher} = record;
	// The target with its captures filled in, and with them left empty: the
	// empty one says which origin the target was written for.
	let target: string | null = null;
	let written = "";
	if (matcher.kind === "pattern") {
		const {scope} = matcher;
		const inScope =
			scope === undefined ||
			u.pathname === scope ||
			u.pathname.startsWith(scope + "/");
		const result = inScope ? matcher.mp.exec(u) : null;
		if (result) {
			const groups = result.pathname.groups;
			const fill = (empty: boolean): string =>
				entry.target.replace(/:(\w+)/g, (m, name: string) =>
					Object.hasOwn(groups, name) ? (empty ? "" : (groups[name] ?? "")) : m,
				);
			target = fill(false);
			written = fill(true);
		}
	} else {
		const {base} = matcher;
		const pathname = u.pathname;
		const path =
			base === undefined
				? pathname
				: pathname === base || pathname.startsWith(base + "/")
					? pathname.slice(base.length) || "/"
					: null;
		const m = path === null ? null : path.match(matcher.re);
		if (m) {
			target = entry.target.replace(
				/\$(\d+)/g,
				(_m, n: string) => m[Number(n)] ?? "",
			);
			written = entry.target.replace(/\$(\d+)/g, "");
			if (base !== undefined) {
				target = targetUnder(target, base);
			}
		}
	}
	if (target === null) {
		return null;
	}
	const location = new URL(target, u);
	// Captures come from the request, so they must not change the origin the
	// target was written for: `$1` from `//evil.com/` would make "$1"
	// protocol-relative, and `@evil.com` after "https://example.com" would
	// make evil.com the host. Only a target written as a URL or `//host` may
	// leave the request's origin, and only for the origin it names.
	let origin = u.origin;
	if (isCrossOriginTarget(entry.target)) {
		if (!URL.canParse(written, u)) {
			return null;
		}
		origin = new URL(written, u).origin;
	}
	if (location.origin !== origin) {
		return null;
	}
	if (!target.includes("?")) location.search = u.search;
	// A redirect never points a request at itself
	if (location.href === u.href) {
		return null;
	}
	return location.toString();
}

/**
 * Throw if captures could change the origin a target was written for, such
 * as `https://$1.example.com/`. Such a redirect could never fire.
 */
function checkTargetOrigin(entry: RedirectEntry): void {
	const {target} = entry;
	if (!isCrossOriginTarget(target)) {
		return;
	}
	let fill: (value: string) => string;
	if ("pattern" in entry.match) {
		const names = new Set(
			Array.from(entry.match.pattern.matchAll(/:(\w+)/g), (m) => m[1]),
		);
		fill = (value) =>
			target.replace(/:(\w+)/g, (m, name: string) =>
				names.has(name) ? value : m,
			);
	} else {
		fill = (value) => target.replace(/\$\d+/g, value);
	}
	const base = "http://localhost";
	const written = fill("");
	const filled = fill("/a");
	if (
		!URL.canParse(written, base) ||
		!URL.canParse(filled, base) ||
		new URL(written, base).origin !== new URL(filled, base).origin
	) {
		throw new Error(
			`Redirect target "${target}" cannot use captures in its origin.`,
		);
	}
}

/**
 * Whether a redirect's target, as written, names another origin: an absolute
 * URL or a protocol-relative `//host`. Anything else stays on the request's
 * origin whatever its captures expand to.
 */
function isCrossOriginTarget(target: string): boolean {
	return target.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(target);
}

/**
 * A redirect as middleware. `from` is a MatchPattern string (`/old/:id`, with
 * `:id` reusable in `to`) or a `RegExp` (with `$1`…`$n` in `to`).
 *
 * Registered with `router.use()`, it is serialized, and it runs at its place
 * in the chain like middleware that returns a response: it answers before
 * any route. With `fallback` set it instead waits for the rest of the chain
 * and only applies when the result is a 404. Called directly, for example
 * inside generator middleware, it returns the redirect `Response`, or null
 * when the request does not match; that call is not serialized and ignores
 * `fallback`.
 */
export function redirect(
	from: string | RegExp,
	to: string,
	options: RedirectOptions = {},
): (request: Request) => Response | null {
	return redirectMiddleware(toRedirectEntry(from, to, options));
}

function redirectResponse(record: RedirectRecord, u: URL): Response | null {
	const location = redirectLocation(record, u);
	return location === null
		? null
		: new Response(null, {
				status: record.entry.status,
				headers: {Location: location},
			});
}

function redirectMiddleware(
	entry: RedirectEntry,
): (request: Request) => Response | null {
	const record = compileRedirect(entry, 0);
	const middleware = (request: Request): Response | null =>
		redirectResponse(record, new URL(request.url));
	redirectEntries.set(middleware, entry);
	return middleware;
}

/**
 * Limit a middleware's serialized redirect to the path prefix it was
 * registered under, matching on segment boundaries like the middleware does.
 */
function scopeRedirect(
	redirect: RedirectEntry,
	pathPrefix: string,
): RedirectEntry {
	if ("pattern" in redirect.match) {
		return {...redirect, match: {...redirect.match, scope: pathPrefix}};
	}
	const {source, flags} = redirect.match;
	if (!source.startsWith("^")) {
		throw new Error("A scoped redirect's pattern must be anchored with ^.");
	}
	return {
		...redirect,
		match: {
			source: `^(?=${escapeRegExp(pathPrefix)}(?:/|$))(?:${source.slice(1)})`,
			flags,
		},
	};
}

/**
 * Rewrite a subrouter's redirect for its mount path. Like its routes, the
 * redirect's pattern and target are relative to the subrouter, so both move
 * under the mount path. A regexp keeps its source and gains a `base`. A
 * target that is an absolute URL stays as it is.
 */
function mountRedirect(entry: RedirectEntry, mountPath: string): RedirectEntry {
	if (mountPath === "/") {
		return entry;
	}
	if ("pattern" in entry.match) {
		if (!entry.match.pattern.startsWith("/")) {
			throw new Error(
				`Cannot mount the redirect from "${entry.match.pattern}": only path patterns can be mounted.`,
			);
		}
		const pattern =
			entry.match.pattern === "/" ? mountPath : mountPath + entry.match.pattern;
		const {scope} = entry.match;
		return {
			...entry,
			match:
				scope === undefined
					? {pattern}
					: {pattern, scope: scope === "/" ? mountPath : mountPath + scope},
			target: targetUnder(entry.target, mountPath),
		};
	}
	return {
		...entry,
		match: {...entry.match, base: mountPath + (entry.match.base ?? "")},
	};
}

/**
 * A subrouter's redirect target as seen from its mount path. Only a path
 * that starts at the subrouter's root moves: relative targets already
 * resolve against the request URL, and absolute URLs stay as they are.
 */
function targetUnder(target: string, mountPath: string): string {
	if (!target.startsWith("/") || target.startsWith("//")) {
		return target;
	}
	return target === "/" ? mountPath : mountPath + target;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Router provides Request/Response routing with middleware support
 * Designed to work universally across all JavaScript runtimes
 */
export class Router {
	readonly routes: RouteEntry[];
	readonly middlewares: MiddlewareEntry[];
	/** Every redirect in declaration order, including those from middleware
	 * such as trailingSlash(). First match wins. Serializable data. */
	readonly redirects: RedirectEntry[];
	#executor: RadixTreeExecutor | null;
	/** Every redirect in declaration order, for toJSON() and mount(). */
	#redirectTable: Array<RedirectRecord & {middleware: MiddlewareEntry}>;
	/** The compiled redirect each redirect middleware entry runs. */
	#redirectRecords: WeakMap<MiddlewareEntry, RedirectRecord>;
	/** Declaration order of each route, on the same counter as redirects. */
	#routeOrder: WeakMap<RouteEntry, number>;
	/** Monotonic declaration counter shared by routes and redirects. */
	#seq: number;
	/** Routes and redirect middleware entries that toJSON() leaves out. */
	#unserialized: WeakSet<RouteEntry | MiddlewareEntry>;
	#maxPathLength: number;

	constructor(options: RouterOptions = {}) {
		this.routes = [];
		this.middlewares = [];
		this.redirects = [];
		this.#executor = null;
		this.#redirectTable = [];
		this.#redirectRecords = new WeakMap();
		this.#routeOrder = new WeakMap();
		this.#seq = 0;
		this.#unserialized = new WeakSet();
		const maxPathLength = options.maxPathLength ?? 2048;
		if (!(maxPathLength > 0)) {
			throw new RangeError(
				"maxPathLength must be a positive number (use Infinity for no limit)",
			);
		}
		this.#maxPathLength = maxPathLength;
	}

	/**
	 * Declare a redirect. Shorthand for `router.use(redirect(from, to))`.
	 */
	redirect(
		from: string | RegExp,
		to: string,
		options: RedirectOptions = {},
	): void {
		this.use(redirect(from, to, options));
	}

	/** @internal Register self-describing middleware as a redirect. */
	#addMiddlewareRedirect(middlewareEntry: MiddlewareEntry): void {
		const entry = redirectEntries.get(middlewareEntry.middleware);
		if (entry === undefined) return;
		let redirect: RedirectEntry = {...entry, match: {...entry.match}};
		if (middlewareEntry.pathPrefix) {
			redirect = scopeRedirect(redirect, middlewareEntry.pathPrefix);
		}
		this.#addRedirectRecord(middlewareEntry, redirect);
	}

	#addRedirectRecord(
		middlewareEntry: MiddlewareEntry,
		redirect: RedirectEntry,
	): void {
		const record = compileRedirect(redirect, this.#seq++);
		this.#redirectRecords.set(middlewareEntry, record);
		this.redirects.push(redirect);
		this.#redirectTable.push({...record, middleware: middlewareEntry});
	}

	/**
	 * The response for `record` redirecting `request`, or null if it does not
	 * match. A redirect that this router's own redirects would lead back to a
	 * URL already visited is refused, so the request carries on as if the
	 * redirect were not there, rather than sending the client around a loop.
	 */
	#redirect(record: RedirectRecord, request: Request): Response | null {
		const from = new URL(request.url);
		const location = redirectLocation(record, from);
		if (location === null) {
			return null;
		}
		const {status} = record.entry;
		if (this.#redirectLoops(from, location, status, request.method)) {
			logger.error`Redirect loop: ${from.href} to ${location} leads back to a URL already visited, so it was not redirected`;
			return null;
		}
		return new Response(null, {status, headers: {Location: location}});
	}

	/**
	 * Whether following this router's redirects from `location` returns to a
	 * URL already visited. Only redirects declared as data are followed: one
	 * returned by a handler, other middleware or another server is not seen.
	 */
	#redirectLoops(
		from: URL,
		location: string,
		status: number,
		method: string,
	): boolean {
		const seen = new Set([from.href]);
		let url = new URL(location);
		for (let hops = 0; hops < MAX_REDIRECT_HOPS; hops++) {
			if (url.origin !== from.origin) {
				return false;
			}
			if (seen.has(url.href)) {
				return true;
			}
			seen.add(url.href);
			// Clients repeat the method only after a 307 or 308
			if (status !== 307 && status !== 308 && method !== "HEAD") {
				method = "GET";
			}
			const next = this.#nextRedirect(url, method);
			if (next === null) {
				return false;
			}
			url = new URL(next.location);
			status = next.status;
		}
		return false;
	}

	/**
	 * Where a request for `url` would be redirected, going by the routes and
	 * redirects alone. A route that matches is taken to answer, so a fallback
	 * redirect is only followed where no route matches. With `refuseLoops`, a
	 * redirect that leads around a loop is passed over, as `handle()` does.
	 */
	#nextRedirect(
		url: URL,
		method: string,
		refuseLoops = false,
	): RedirectResolution | null {
		if (url.pathname.length > this.#maxPathLength) {
			return null;
		}
		const follow = (record: RedirectRecord): RedirectResolution | null => {
			const location = redirectLocation(record, url);
			if (location === null) {
				return null;
			}
			const {status} = record.entry;
			if (refuseLoops && this.#redirectLoops(url, location, status, method)) {
				return null;
			}
			return {location, status};
		};
		const table = this.#redirectTable;
		for (const record of table) {
			if (record.entry.fallback) continue;
			const redirect = follow(record);
			if (redirect) {
				return redirect;
			}
		}
		if (this.#ensureCompiled().matchPath(url.pathname, method)) {
			return null;
		}
		// Fallback redirects answer on the way back up the chain, last first
		for (let i = table.length - 1; i >= 0; i--) {
			const record = table[i];
			if (!record.entry.fallback) continue;
			const redirect = follow(record);
			if (redirect) {
				return redirect;
			}
		}
		return null;
	}

	/**
	 * What this router's routes and redirects say about a URL, without running
	 * any handler or middleware: the redirect it would be sent, the route that
	 * matches it, or null when the router has nothing for it. On a router from
	 * `fromJSON()` this agrees with `handle()`. A client router uses it to
	 * decide whether a navigation is its to handle.
	 */
	resolve(url: string | URL, method = "GET"): Resolution | null {
		const u = new URL(url, "http://localhost");
		const redirect = this.#nextRedirect(u, method, true);
		if (redirect) {
			return {redirect};
		}
		if (
			u.pathname.length > this.#maxPathLength ||
			!this.#ensureCompiled().matchPath(u.pathname, method)
		) {
			return null;
		}
		const route = this.match(u);
		return route ? {route} : null;
	}

	/**
	 * Ensure the executor is compiled and up to date
	 */
	#ensureCompiled(): RadixTreeExecutor {
		if (!this.#executor) {
			this.#executor = new RadixTreeExecutor(this.routes);
		}
		return this.#executor;
	}

	/**
	 * Register middleware that applies to all routes
	 * Middleware executes in the order it was registered
	 *
	 * Middleware made by `redirect()`, such as `trailingSlash()`, runs in
	 * declaration order like any other middleware, and it is serialized.
	 */
	use(middleware: Middleware): void;

	/**
	 * Register middleware that only applies to routes matching the path prefix
	 */
	use(pathPrefix: string, middleware: Middleware): void;

	use(
		pathPrefixOrMiddleware: string | Middleware,
		maybeMiddleware?: Middleware,
	): void {
		if (typeof pathPrefixOrMiddleware === "string") {
			// Path-scoped middleware
			const middleware = maybeMiddleware!;
			if (!this.#isValidMiddleware(middleware)) {
				throw new Error(
					"Invalid middleware type. Must be function or async generator function.",
				);
			}
			const entry = {middleware, pathPrefix: pathPrefixOrMiddleware};
			this.middlewares.push(entry);
			this.#addMiddlewareRedirect(entry);
		} else {
			// Global middleware
			if (!this.#isValidMiddleware(pathPrefixOrMiddleware)) {
				throw new Error(
					"Invalid middleware type. Must be function or async generator function.",
				);
			}
			const entry = {middleware: pathPrefixOrMiddleware};
			this.middlewares.push(entry);
			this.#addMiddlewareRedirect(entry);
		}
		this.#executor = null;
	}

	/**
	 * Create a route builder for the given pattern
	 * Returns a chainable interface for registering HTTP method handlers
	 *
	 * Example:
	 *   router.route('/api/users/:id', { name: 'user' })
	 *     .use(authMiddleware)
	 *     .get(getUserHandler)
	 *     .put(updateUserHandler);
	 */
	route(pattern: string, options?: RouteOptions): RouteBuilder {
		return new RouteBuilder(this, pattern, options);
	}

	/**
	 * Internal method called by RouteBuilder to register routes
	 * Public for RouteBuilder access, but not intended for direct use
	 */
	addRoute(
		method: HTTPMethod,
		pattern: string,
		handler?: Handler,
		name?: string,
		middlewares: Middleware[] = [],
		serialize = true,
	): void {
		const matchPattern = new MatchPattern(pattern);

		const entry: RouteEntry = {
			pattern: matchPattern,
			method: method.toUpperCase(),
			handler,
			name,
			middlewares: middlewares,
		};
		this.routes.push(entry);
		this.#routeOrder.set(entry, this.#seq++);
		if (!serialize) {
			this.#unserialized.add(entry);
		}
		this.#executor = null;
	}

	/**
	 * Match a URL against registered routes
	 * Returns route info (params, methods, name, pattern) or null if no match
	 * Does not execute handlers - use handle() for that
	 */
	match(url: string | URL): RouteMatch | null {
		const executor = this.#ensureCompiled();
		const pathname =
			typeof url === "string"
				? new URL(url, "http://localhost").pathname
				: url.pathname;
		if (pathname.length > this.#maxPathLength) {
			return null;
		}
		return executor.matchURL(url);
	}

	/**
	 * Handle a request - main entrypoint for ServiceWorker usage
	 * Executes the matched handler with middleware chain
	 */
	async handle(request: Request): Promise<Response> {
		const executor = this.#ensureCompiled();

		let response: Response;
		try {
			if (new URL(request.url).pathname.length > this.#maxPathLength) {
				throw new HTTPError(414);
			}

			// Find matching route
			const matchResult = executor.matchRequest(request);
			let handler: Handler;
			let context: RouteContext;
			let routeMiddleware: Middleware[] = [];

			if (matchResult) {
				// Route found - use its handler and context
				handler =
					matchResult.handler ??
					(async () => {
						throw new NotFound("Route has no handler");
					});
				context = matchResult.context;
				routeMiddleware = matchResult.entry.middlewares;
			} else {
				// No route found - use 404 handler and empty context
				handler = async () => {
					throw new NotFound();
				};
				context = {params: {}};
			}

			// Execute middleware chain with the handler
			response = await this.#executeMiddlewareStack(
				this.middlewares,
				routeMiddleware,
				request,
				context,
				handler,
				matchResult !== null && !matchResult.handler,
			);

			// HEAD requests should return headers only, no body (RFC 7231)
			if (request.method.toUpperCase() === "HEAD") {
				response = new Response(null, {
					status: response.status,
					statusText: response.statusText,
					headers: response.headers,
				});
			}
		} catch (error) {
			// Final catch-all for unhandled errors
			response = this.#createErrorResponse(error as Error);
		}

		return response;
	}

	/**
	 * Mount a subrouter at a specific path prefix
	 * All routes from the subrouter will be prefixed with the mount path
	 *
	 * Example:
	 *   const apiRouter = new Router();
	 *   apiRouter.route('/users').get(getUsersHandler);
	 *   apiRouter.route('/users/:id').get(getUserHandler);
	 *
	 *   const mainRouter = new Router();
	 *   mainRouter.mount('/api/v1', apiRouter);
	 *   // Routes become: /api/v1/users, /api/v1/users/:id
	 *
	 * Pass `{serialize: false}` to keep the subrouter's routes and redirects
	 * out of `toJSON()`.
	 */
	mount(
		mountPath: string,
		subrouter: Router,
		options: MountOptions = {},
	): void {
		const serialize = options.serialize !== false;
		// Normalize mount path - ensure it starts with / and doesn't end with /
		const normalizedMountPath = this.#normalizeMountPath(mountPath);

		const mounted = new Map<MiddlewareEntry, MiddlewareEntry>();
		for (const submiddleware of subrouter.middlewares) {
			// If subrouter middleware has pathPrefix "/inner", and we mount at
			// "/outer", the composed prefix becomes "/outer/inner"
			const entry: MiddlewareEntry = {
				middleware: submiddleware.middleware,
				pathPrefix: submiddleware.pathPrefix
					? this.#combinePaths(normalizedMountPath, submiddleware.pathPrefix)
					: normalizedMountPath === "/"
						? undefined
						: normalizedMountPath,
			};
			this.middlewares.push(entry);
			mounted.set(submiddleware, entry);
		}

		const items: Array<
			| {order: number; route: RouteEntry}
			| {order: number; middleware: MiddlewareEntry; redirect: RedirectEntry}
		> = [];
		for (const route of subrouter.routes) {
			items.push({order: subrouter.#routeOrder.get(route)!, route});
		}
		for (const record of subrouter.#redirectTable) {
			items.push({
				order: record.order,
				middleware: record.middleware,
				redirect: record.entry,
			});
		}
		items.sort((a, b) => a.order - b.order);
		for (const item of items) {
			if ("route" in item) {
				const subroute = item.route;
				const entry: RouteEntry = {
					pattern: new MatchPattern(
						this.#combinePaths(normalizedMountPath, subroute.pattern.pathname),
					),
					method: subroute.method,
					handler: subroute.handler,
					name: subroute.name,
					middlewares: subroute.middlewares,
				};
				this.routes.push(entry);
				this.#routeOrder.set(entry, this.#seq++);
				if (!serialize || subrouter.#unserialized.has(subroute)) {
					this.#unserialized.add(entry);
				}
			} else {
				const entry = mounted.get(item.middleware)!;
				this.#addRedirectRecord(
					entry,
					mountRedirect(item.redirect, normalizedMountPath),
				);
				if (!serialize || subrouter.#unserialized.has(item.middleware)) {
					this.#unserialized.add(entry);
				}
			}
		}

		this.#executor = null;
	}

	/**
	 * Normalize mount path: ensure it starts with / and doesn't end with /
	 */
	#normalizeMountPath(mountPath: string): string {
		if (!mountPath.startsWith("/")) {
			mountPath = "/" + mountPath;
		}
		if (mountPath.endsWith("/") && mountPath.length > 1) {
			mountPath = mountPath.slice(0, -1);
		}
		return mountPath;
	}

	/**
	 * Combine mount path with route pattern
	 */
	#combinePaths(mountPath: string, routePattern: string): string {
		if (mountPath === "/") {
			return routePattern.startsWith("/") ? routePattern : "/" + routePattern;
		}
		// Handle root path specially
		if (routePattern === "/") {
			return mountPath;
		}

		// Ensure route pattern starts with /
		if (!routePattern.startsWith("/")) {
			routePattern = "/" + routePattern;
		}

		return mountPath + routePattern;
	}

	/**
	 * Validate that a function is valid middleware
	 */
	#isValidMiddleware(middleware: Middleware): boolean {
		const constructorName = middleware.constructor.name;
		return (
			constructorName === "AsyncGeneratorFunction" ||
			constructorName === "GeneratorFunction" ||
			constructorName === "AsyncFunction" ||
			constructorName === "Function"
		);
	}

	/**
	 * Detect if a function is a generator middleware
	 */
	#isGeneratorMiddleware(middleware: Middleware): boolean {
		const name = middleware.constructor.name;
		return name === "GeneratorFunction" || name === "AsyncGeneratorFunction";
	}

	/**
	 * Check if a request pathname matches a middleware's path prefix
	 * Matches on segment boundaries: /admin matches /admin, /admin/, /admin/users
	 * but NOT /administrator
	 */
	#matchesPathPrefix(pathname: string, pathPrefix: string): boolean {
		// Exact match
		if (pathname === pathPrefix) {
			return true;
		}

		// Check if pathname starts with prefix followed by / or end of string
		if (pathname.startsWith(pathPrefix)) {
			const nextChar = pathname[pathPrefix.length];
			// Must be followed by / or be at end (for trailing slash case)
			return nextChar === "/" || nextChar === undefined;
		}

		return false;
	}

	/**
	 * Execute a single middleware and track generator state
	 * Returns true if middleware short-circuited (returned Response early)
	 */
	async #executeMiddleware(
		middleware: Middleware,
		request: Request,
		context: RouteContext,
		runningGenerators: PendingMiddleware[],
	): Promise<Response | null> {
		if (this.#isGeneratorMiddleware(middleware)) {
			const generator = (middleware as GeneratorMiddleware)(request, context);
			const result = await generator.next();

			if (result.done) {
				// Early return (0 yields) - check if Response returned for short-circuiting
				if (result.value) {
					return result.value;
				}
			} else {
				// Generator yielded - save for later resumption
				runningGenerators.push({generator});
			}
		} else {
			// Function middleware - execute and check for short-circuit
			const result = await (middleware as FunctionMiddleware)(request, context);
			if (result) {
				// Function middleware returned a Response - short-circuit
				return result;
			}
		}
		return null;
	}

	/**
	 * Execute middleware stack with guaranteed execution using Rack-style LIFO order
	 * Global/path middleware runs first, then route-scoped middleware, then handler
	 */
	async #executeMiddlewareStack(
		globalMiddlewares: MiddlewareEntry[],
		routeMiddlewares: Middleware[],
		request: Request,
		context: RouteContext,
		handler: Handler,
		matchedWithoutHandler: boolean,
	): Promise<Response> {
		const runningGenerators: PendingMiddleware[] = [];
		let currentResponse: Response | null = null;

		// Extract pathname from request URL for prefix matching
		const requestPathname = new URL(request.url).pathname;

		// Phase 1a: Execute global/path-scoped middleware "before" phases
		for (const entry of globalMiddlewares) {
			// Skip middleware if it has a pathPrefix that doesn't match
			if (
				entry.pathPrefix &&
				!this.#matchesPathPrefix(requestPathname, entry.pathPrefix)
			) {
				continue;
			}

			const record = this.#redirectRecords.get(entry);
			if (record) {
				if (record.entry.fallback) {
					// A fallback redirect decides once the rest of the chain has
					// answered, so it waits here like a generator that yielded. A
					// match-only router has no handlers to run, so there a
					// matching route counts as handled.
					if (!matchedWithoutHandler) {
						runningGenerators.push({fallback: record});
					}
					continue;
				}
				// Any other redirect answers here, like middleware that returns
				// a response
				currentResponse = this.#redirect(record, request);
				if (currentResponse) break;
				continue;
			}

			currentResponse = await this.#executeMiddleware(
				entry.middleware,
				request,
				context,
				runningGenerators,
			);
			if (currentResponse) break; // Short-circuit
		}

		// Phase 1b: Execute route-scoped middleware "before" phases
		if (!currentResponse) {
			for (const middleware of routeMiddlewares) {
				currentResponse = await this.#executeMiddleware(
					middleware,
					request,
					context,
					runningGenerators,
				);
				if (currentResponse) break; // Short-circuit
			}
		}

		// Phase 2: Get handler response if no middleware returned early
		if (!currentResponse) {
			// Execute handler
			let handlerError: Error | null = null;
			try {
				currentResponse = await handler(request, context);
			} catch (error) {
				handlerError = error as Error;
			}

			// Handle errors through generator stack if needed
			if (handlerError) {
				currentResponse = await this.#handleErrorThroughGenerators(
					handlerError,
					runningGenerators,
					request,
				);
			}
		}

		// Phase 3: Resume all generators in reverse order (LIFO - Last In First Out)
		// This implements the Rack-style guaranteed execution
		for (let i = runningGenerators.length - 1; i >= 0; i--) {
			const {generator, fallback} = runningGenerators[i];
			if (fallback) {
				if (currentResponse!.status === 404) {
					currentResponse =
						this.#redirect(fallback, request) ?? currentResponse;
				}
				continue;
			}
			// currentResponse should always be set by this point (from handler or short-circuit)
			// Use non-null assertion since generators expect a Response
			const result = await generator.next(currentResponse!);
			// result.value is the return value (Response | null | undefined), not the yield (Request)
			if (result.value && result.done) {
				currentResponse = result.value;
			}
		}

		return currentResponse!;
	}

	/**
	 * Handle errors by trying generators in reverse order
	 */
	async #handleErrorThroughGenerators(
		error: Error,
		runningGenerators: PendingMiddleware[],
		request: Request,
	): Promise<Response> {
		// Try error handling starting from the innermost middleware (reverse order)
		for (let i = runningGenerators.length - 1; i >= 0; i--) {
			const {generator, fallback} = runningGenerators[i];
			if (fallback) {
				// Like a generator, it is done once the error has passed it
				runningGenerators.splice(i, 1);
				if (isHTTPError(error) && error.status === 404) {
					const response = this.#redirect(fallback, request);
					if (response) {
						return response;
					}
				}
				continue;
			}

			try {
				const result = await generator.throw(error);
				// When done=true, value is the return type (Response | null | undefined)
				// When done=false, value is the yield type (Request) - generator caught and re-yielded
				if (result.done && result.value) {
					// This generator handled the error - remove it from the stack
					// so it doesn't get resumed again in phase 3
					runningGenerators.splice(i, 1);
					return result.value;
				}
			} catch (generatorError) {
				// This generator rethrew - continue to next generator
				// Remove this generator from the stack since it failed
				runningGenerators.splice(i, 1);
				continue;
			}
		}

		// No generator handled the error
		throw error;
	}

	/**
	 * Serialize the router to a plain, JSON-safe value. Named `toJSON` so
	 * `JSON.stringify(router)` works for free. Routes and redirects are emitted
	 * as one list in declaration order.
	 * Handlers and middleware are server-only and left out, except middleware
	 * made by `redirect()`, such as `trailingSlash()`, which is a redirect at
	 * the point it was registered. Routes declared with `serialize: false`,
	 * and everything from a subrouter mounted with it, are left out too.
	 */
	toJSON(): SerializedRouter {
		const items: Array<{order: number; entry: SerializedEntry}> = [];
		for (const route of this.routes) {
			if (this.#unserialized.has(route)) continue;
			items.push({
				order: this.#routeOrder.get(route)!,
				entry: {
					route: {
						pattern: route.pattern.pathname,
						method: route.method,
						...(route.name !== undefined ? {name: route.name} : {}),
					},
				},
			});
		}
		for (const {entry, order, middleware} of this.#redirectTable) {
			if (this.#unserialized.has(middleware)) continue;
			items.push({order, entry: {redirect: entry}});
		}
		items.sort((a, b) => a.order - b.order);
		return {format: 1, entries: items.map((it) => it.entry)};
	}

	/**
	 * Reconstruct a **match-only** router from `toJSON()` output (an object or a
	 * JSON string). `match()` behaves identically to the source router;
	 * `handle()` 404s by design, because no handlers were serialized. This is
	 * the client-side half of "client matches, server handles".
	 */
	static fromJSON(data: SerializedRouter | string): Router {
		const parsed: SerializedRouter =
			typeof data === "string" ? JSON.parse(data) : data;
		if (parsed === null || typeof parsed !== "object") {
			throw new Error("Cannot deserialize router: expected an object.");
		}
		if (parsed.format !== 1) {
			throw new Error(
				`Unsupported serialized router format: ${String(parsed.format)}`,
			);
		}
		const router = new Router();
		for (const entry of parsed.entries) {
			if ("route" in entry) {
				// No handler → match-only. handle() falls through to 404.
				router.addRoute(
					entry.route.method as HTTPMethod,
					entry.route.pattern,
					undefined,
					entry.route.name,
				);
			} else {
				router.use(redirectMiddleware(entry.redirect));
			}
		}
		return router;
	}

	/**
	 * Create an error response for unhandled errors
	 * Uses HTTPError.toResponse() for consistent error formatting
	 */
	#createErrorResponse(error: Error): Response {
		// Only be verbose when explicitly in development. An unset MODE must not
		// leak stack traces to clients, so this fails closed.
		const isDev = import.meta.env?.MODE === "development";
		if (isDev && !isHTTPError(error)) {
			logger.error`Unhandled error: ${error}`;
		}

		// Convert to HTTPError for consistent response format
		const httpError = isHTTPError(error)
			? (error as HTTPError)
			: new InternalServerError(error.message, {cause: error});

		return httpError.toResponse(isDev);
	}
}

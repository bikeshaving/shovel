/**
 * Client-side navigation for a Router, built on the Navigation API.
 *
 * The router decides, from its routes and redirects alone, whether a
 * navigation is the page's to handle. Everything it has no answer for is
 * left to the browser, which loads the page from the server as usual.
 *
 * There is no History API fallback. Where `window.navigation` is missing,
 * `listen()` does nothing and every navigation is an ordinary page load;
 * load a Navigation API polyfill first to change that.
 */

import type {RouteMatch, Router} from "./index.js";

/**
 * The parts of the Navigation API's `NavigateEvent` this module uses.
 * A real `NavigateEvent` fits it.
 */
export interface NavigateEventLike {
	readonly canIntercept: boolean;
	readonly cancelable: boolean;
	readonly hashChange: boolean;
	readonly downloadRequest: string | null;
	readonly formData: FormData | null;
	readonly navigationType: string;
	readonly destination: {readonly url: string};
	readonly signal: AbortSignal;
	readonly info?: unknown;
	preventDefault(): void;
	intercept(options?: {handler?: () => Promise<void>}): void;
}

/**
 * The parts of `window.navigation` this module uses.
 * The real `window.navigation` fits it.
 */
export interface NavigationLike {
	addEventListener(
		type: "navigate",
		listener: (event: NavigateEventLike) => void,
	): void;
	removeEventListener(
		type: "navigate",
		listener: (event: NavigateEventLike) => void,
	): void;
	navigate(url: string, options?: {history?: string; info?: unknown}): unknown;
}

/**
 * A navigation the router matched to a route
 */
export interface ClientNavigation {
	/** Where the navigation is going */
	url: URL;
	/** The route that matched, with its params and name */
	route: RouteMatch;
	/** GET, or POST for a form submission */
	method: string;
	/** The submitted form's data, for a POST */
	formData: FormData | null;
	/** Aborts when the navigation is superseded or stopped: pass it to fetch */
	signal: AbortSignal;
	/** The underlying navigate event */
	event: NavigateEventLike;
	/**
	 * Go somewhere else instead, replacing this navigation's history entry.
	 * For a redirect only the server could decide, such as a fetch that came
	 * back with `response.redirected`: `redirect(response.url)`.
	 */
	redirect(url: string | URL): void;
}

export interface ListenOptions {
	/** Defaults to `window.navigation` */
	navigation?: NavigationLike;
}

/**
 * Handle navigations with `router`. `handler` is called for each navigation
 * that matches one of the router's routes, after the URL has changed, and
 * the navigation finishes when its promise settles. The router's own
 * redirects are applied first. Returns a function that stops listening.
 *
 * The browser handles everything else as usual: other origins, downloads,
 * hash changes, and any URL the router has no route or redirect for.
 */
export function listen(
	router: Router,
	handler: (navigation: ClientNavigation) => void | Promise<void>,
	options: ListenOptions = {},
): () => void {
	const navigation =
		options.navigation ??
		(globalThis as {navigation?: NavigationLike}).navigation;
	if (!navigation) {
		return () => {};
	}

	const onNavigate = (event: NavigateEventLike): void => {
		if (
			!event.canIntercept ||
			event.hashChange ||
			event.downloadRequest !== null
		) {
			return;
		}
		const url = new URL(event.destination.url);
		const method = event.formData ? "POST" : "GET";
		const resolution = router.resolve(url, method);
		if (!resolution) {
			return;
		}

		const {redirect, route} = resolution;
		if (redirect) {
			// Start over at the redirect's target. Where this navigation can be
			// cancelled, the URL it asked for never gets a history entry; a
			// back or forward cannot be, so its entry is replaced instead.
			const history =
				!event.cancelable || event.navigationType === "replace"
					? "replace"
					: "auto";
			if (event.cancelable) {
				event.preventDefault();
			}
			navigation.navigate(redirect.location, {history, info: event.info});
			return;
		}

		event.intercept({
			handler: async () => {
				await handler({
					url,
					route,
					method,
					formData: event.formData,
					signal: event.signal,
					event,
					redirect(to) {
						navigation.navigate(new URL(to, url).href, {history: "replace"});
					},
				});
			},
		});
	};

	navigation.addEventListener("navigate", onNavigate);
	return () => navigation.removeEventListener("navigate", onNavigate);
}

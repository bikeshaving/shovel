/**
 * The page side of the end-to-end tests: a client router from the server's
 * serialized routes, whose handler fetches each page's content and puts it
 * in #view.
 */
import {Router} from "../../src/index.js";
import {listen} from "../../src/client.js";

declare const document: {
	getElementById(id: string): {textContent: string | null} | null;
};

const state = globalThis as unknown as {
	__ROUTES__: string;
	/** One line per navigation the handler saw */
	__handled__: string[];
};
state.__handled__ = [];

listen(
	Router.fromJSON(state.__ROUTES__),
	async ({url, route, method, formData, signal, redirect}) => {
		state.__handled__.push(`${method} ${url.pathname}${url.search}`);
		const response = await fetch(url, {
			method,
			body: formData,
			headers: {"X-Client": "1"},
			signal,
		});
		if (response.redirected) {
			// A redirect only the server could decide
			redirect(response.url);
			return;
		}
		const text = await response.text();
		document.getElementById("view")!.textContent =
			`${route.name ?? "unnamed"}: ${text}`;
	},
);

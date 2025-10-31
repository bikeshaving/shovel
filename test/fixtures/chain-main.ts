import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";
import {value} from "./chain-a.ts";

self.addEventListener("fetch", (event) => {
	const html = renderer.render(jsx`<div>${value}</div>`);
	event.respondWith(
		new Response(html, {
			headers: {"content-type": "text/html; charset=UTF-8"},
		}),
	);
});

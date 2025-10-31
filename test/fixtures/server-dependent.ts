import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";
import * as dependent from "./server-dependency-hello.ts";

self.addEventListener("fetch", (event) => {
	const html = renderer.render(jsx`
		<marquee>${dependent.greeting}</marquee>
	`);
	event.respondWith(
		new Response(html, {
			headers: {"content-type": "text/html; charset=UTF-8"},
		}),
	);
});

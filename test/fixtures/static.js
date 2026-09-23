import {renderer} from "@b9g/crank/html";
import {jsx} from "@b9g/crank/standalone";

self.addEventListener("fetch", (event) => {
	const html = renderer.render(jsx`<marquee>Hello world</marquee>`);
	event.respondWith(
		new Response(html, {headers: {"content-type": "text/html; charset=UTF-8"}}),
	);
});

/// <reference types="@b9g/platform" />
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";

self.addEventListener("fetch", (event) => {
	const html = renderer.render(jsx`<marquee>Hello world</marquee>`) as string;
	event.respondWith(
		new Response(html, {
			headers: {"content-type": "text/html; charset=UTF-8"},
		}),
	);
});

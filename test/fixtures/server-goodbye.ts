/* eslint-disable no-console -- Test fixture intentionally logs */
/// <reference types="@b9g/platform" />
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";

self.addEventListener("fetch", (event) => {
	console.info("serving: goodbye page");
	const html = renderer.render(jsx`<marquee>Goodbye world</marquee>`) as string;
	event.respondWith(
		new Response(html, {
			headers: {"content-type": "text/html; charset=UTF-8"},
		}),
	);
});

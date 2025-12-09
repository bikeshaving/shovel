/// <reference types="@b9g/platform" />
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";
import {value} from "./chain-a.js";

self.addEventListener("fetch", (event) => {
	const html = renderer.render(jsx`<div>${value}</div>`) as string;
	event.respondWith(
		new Response(html, {
			headers: {"content-type": "text/html; charset=UTF-8"},
		}),
	);
});

/* eslint-disable no-console -- Test fixture intentionally logs */
/// <reference types="@b9g/platform" />
import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";

console.info("executing server-dynamic-dependent.ts");

self.addEventListener("fetch", (event) => {
	event.respondWith(
		(async () => {
			const dependent = await import("./server-dependency-hello.js");
			let html = renderer.render(jsx`
				<marquee behavior="alternate">${dependent.greeting}</marquee>
			`) as string;

			return new Response(html, {
				headers: {"content-type": "text/html; charset=UTF-8"},
			});
		})(),
	);
});

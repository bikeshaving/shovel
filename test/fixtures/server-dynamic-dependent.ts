import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";

console.info("executing server-dynamic-dependent.ts");

self.addEventListener("fetch", async (event) => {
	const dependent = await import("./server-dependency-hello.ts");
	let html = renderer.render(jsx`
		<marquee behavior="alternate">${dependent.greeting}</marquee>
	`);

	event.respondWith(
		new Response(html, {
			headers: {"content-type": "text/html; charset=UTF-8"},
		}),
	);
});

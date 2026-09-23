import * as Dependent1 from "./dependent1.js";
import * as Dependent2 from "./dependent2.js";

self.addEventListener("fetch", (event) => {
	const html = `<div>${Dependent1.value} ${Dependent2.value}</div>`;
	event.respondWith(
		new Response(html, {headers: {"content-type": "text/html; charset=UTF-8"}}),
	);
});

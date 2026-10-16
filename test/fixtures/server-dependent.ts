/// <reference types="@b9g/platform" />
import {renderer} from "@b9g/crank/html";
import {jsx} from "@b9g/crank/standalone";

import * as Dependent from "./server-dependency-hello.js";

self.addEventListener("fetch", (event) => {
	const html = renderer.render(
		jsx`
		<marquee>${Dependent.greeting}</marquee>
	`,
	) as string;
	event.respondWith(
		new Response(html, {headers: {"content-type": "text/html; charset=UTF-8"}}),
	);
});

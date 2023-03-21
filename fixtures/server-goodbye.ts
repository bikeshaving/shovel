import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";
//import noop from "./noop.ts";
import {css} from "@emotion/css";

export default {
	async fetch(req: Request) {
		console.log("serving:", req.url);
		console.log("dynamic:", (await import("./noop.ts")).test);
		console.log("default await:", await (await import("./noop.ts")).default());
		const html = renderer.render(jsx`<marquee>Goodbye world</marquee>`);
		return new Response(html, {
			headers: {"content-type": "text/html; charset=UTF-8"},
		});
	},
};

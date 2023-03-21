import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";
import {css} from "@emotion/css";

export default {
	async fetch(req: Request) {
		console.log("serving:", req.url);
		const html = renderer.render(jsx`<marquee>Goodbye world</marquee>`);
		return new Response(html, {
			headers: {"content-type": "text/html; charset=UTF-8"},
		});
	},
};

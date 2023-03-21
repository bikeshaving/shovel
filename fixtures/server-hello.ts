import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";
import {css} from "@emotion/css";

export default {
	async fetch(req: Request) {
		const html = renderer.render(jsx`<marquee>Hello world</marquee>`);
		return new Response(html, {
			headers: {"content-type": "text/html; charset=UTF-8"},
		});
	},
};

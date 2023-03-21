import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";
import {css} from "@emotion/css";
import * as dependent from "./server-dependency-hello.ts";

export default {
	async fetch(req: Request) {
		const html = renderer.render(jsx`
			<marquee>${dependent.greeting}</marquee>
		`);
		return new Response(html, {
			headers: {"content-type": "text/html; charset=UTF-8"},
		});
	},
};

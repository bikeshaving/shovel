import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";
import noop from "./noop.ts";

import {css} from "@emotion/css";
export default {
	fetch(req: Request) {

		noop();
		console.log(css);
		//throw new Error("Poop");
		const html = renderer.render(jsx`<div>Hello from Crank</div>`);

		return new Response(html, {
			headers: {"content-type": "text/html; charset=UTF-8"},
		});
	},

	develop(hot) {
		hot.decline();
		hot.dispose(() => {
			console.log("module disposed");
		});
	},
};

import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";

export default {
	fetch(req: Request) {
		console.log("serving:", req.url);
		const html = renderer.render(jsx`<div>Hellooo from Crank</div>`);
		return new Response(html, {
			headers: {"content-type": "text/html;charset=UTF-8"},
		});
	}
};

import * as dependent1 from "./dependent1.js";
import * as dependent2 from "./dependent2.js";

export default {
	fetch(req) {
		const html = `<div>${dependent1.value} ${dependent2.value}</div>`;
		return new Response(html, {
			headers: {"content-type": "text/html; charset=UTF-8"},
		});
	},
};

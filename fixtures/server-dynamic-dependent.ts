import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";

console.log("executing server-dynamic-dependent.ts");
export default {
	async fetch(req: Request) {
		const dependent = await import("./server-dependency-hello.ts");
		let html = renderer.render(jsx`
			<marquee behavior="alternate">${dependent.greeting}</marquee>
		`);

		return new Response(html, {
			headers: {"content-type": "text/html; charset=UTF-8"},
		});
	},
};

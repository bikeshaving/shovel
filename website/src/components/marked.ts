import {jsx, Raw} from "@b9g/crank/standalone";
import {marked, Renderer} from "marked";
import {highlight} from "../utils/prism.js";

const renderer = new Renderer();
const originalLink = renderer.link.bind(renderer);

renderer.link = function (href, title, text) {
	// Transform relative .md links to /docs/ URLs
	if (href && href.startsWith("./") && href.endsWith(".md")) {
		href = "/docs/" + href.slice(2, -3);
	}
	return originalLink(href, title, text);
};

export function Marked({markdown}: {markdown: string}) {
	const html = marked(markdown, {
		renderer,
		highlight: (code, lang) => {
			try {
				return highlight(code, lang || "javascript");
			} catch (_err) {
				return code;
			}
		},
	});

	return jsx`<${Raw} value=${html} />`;
}

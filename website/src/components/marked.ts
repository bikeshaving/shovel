import {jsx, Raw} from "@b9g/crank/standalone";
import {marked} from "marked";
import {highlight} from "../utils/prism.js";

export function Marked({markdown}: {markdown: string}) {
	const html = marked(markdown, {
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

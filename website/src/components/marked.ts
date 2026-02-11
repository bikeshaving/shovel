import {jsx, Raw} from "@b9g/crank/standalone";
import {marked, Renderer} from "marked";
import {highlight} from "../utils/prism.js";

// Strip numeric prefixes like "01-", "02-" from guide slugs
function stripNumericPrefix(slug: string): string {
	return slug.replace(/^(\d+-)+/, "");
}

function createRenderer(linkBase: string): Renderer {
	const renderer = new Renderer();
	const originalLink = renderer.link.bind(renderer);

	renderer.link = function (href, title, text) {
		if (href) {
			// Cross-reference: ../reference/foo.md → /api/foo
			const crossRef = href.match(/^\.\.\/reference\/(.+)\.md(#.*)?$/);
			if (crossRef) {
				href = "/api/" + crossRef[1] + (crossRef[2] || "");
			} else {
				// Sibling link: ./foo.md → /{linkBase}/foo
				const sibling = href.match(/^\.\/(.+)\.md(#.*)?$/);
				if (sibling) {
					const slug =
						linkBase === "guides" ? stripNumericPrefix(sibling[1]) : sibling[1];
					href = "/" + linkBase + "/" + slug + (sibling[2] || "");
				}
			}
		}

		return originalLink(href, title, text);
	};

	return renderer;
}

export function Marked({
	markdown,
	linkBase = "api",
}: {
	markdown: string;
	linkBase?: string;
}) {
	const renderer = createRenderer(linkBase);
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

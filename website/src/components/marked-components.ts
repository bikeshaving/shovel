import {jsx, Raw} from "@b9g/crank/standalone";
import {highlight} from "../utils/prism.js";

// Strip numeric prefixes like "01-", "02-" from guide slugs
function stripNumericPrefix(slug: string): string {
	return slug.replace(/^(\d+-)+/, "");
}

// Reproduces the slugs marked's headerIds option generated: lowercase, drop
// punctuation, spaces to hyphens. Crank's default slugify turns punctuation
// into hyphens instead, which would break existing #anchor links.
function headingSlug(text: string): string {
	return text
		.toLowerCase()
		.trim()
		.replace(/[^\w\- ]+/g, "")
		.replace(/ /g, "-");
}

// marked also deduped repeated slugs ("parameters", then "parameters-1").
// Counters hang off rootProps, a fresh object per Marked render, so they reset
// per document rather than leaking across pages.
const slugCounts = new WeakMap<object, Map<string, number>>();

function uniqueSlug(rootProps: object, base: string): string {
	let counts = slugCounts.get(rootProps);
	if (!counts) {
		counts = new Map();
		slugCounts.set(rootProps, counts);
	}

	const seen = counts.get(base) ?? 0;
	counts.set(base, seen + 1);
	return seen === 0 ? base : `${base}-${seen}`;
}

// Markdown files link to each other by relative path so they resolve on GitHub;
// the site serves them at extensionless URLs. Previously done by patching
// renderer.link — the same rules, now as a component override.
function resolveHref(href: string, linkBase: string): string {
	// Cross-reference: ../reference/foo.md -> /api/foo
	const crossRef = href.match(/^\.\.\/reference\/(.+)\.md(#.*)?$/);
	if (crossRef) {
		return "/api/" + crossRef[1] + (crossRef[2] || "");
	}

	// Sibling link: ./foo.md -> /{linkBase}/foo
	const sibling = href.match(/^\.\/(.+)\.md(#.*)?$/);
	if (sibling) {
		const slug =
			linkBase === "guides" ? stripNumericPrefix(sibling[1]) : sibling[1];
		return "/" + linkBase + "/" + slug + (sibling[2] || "");
	}

	return href;
}

export const components = {
	heading({token, children, rootProps}: any) {
		const tag = `h${token.depth}`;
		const id = uniqueSlug(rootProps, headingSlug(token.text));
		return jsx`<${tag} id=${id}>${children}<//>`;
	},

	link({token, children, rootProps}: any) {
		const {href, title} = token;
		const linkBase = rootProps.linkBase ?? "api";
		const resolved = href ? resolveHref(href, linkBase) : href;
		return jsx`<a href=${resolved} title=${title}>${children}</a>`;
	},

	code({token}: any) {
		const {text, lang} = token;
		let highlighted: string | null;
		try {
			highlighted = highlight(text, lang || "javascript");
		} catch (_err) {
			highlighted = null;
		}

		const className = lang ? `language-${lang}` : null;
		// marked's code renderer ended the block with a newline before </code>;
		// keep it so code blocks render identically.
		// Fall back to the plain text child, which Crank escapes, rather than
		// injecting unhighlighted source as raw markup. Kept on one line: any
		// newline in this template would land inside the <pre>.
		const content =
			highlighted == null
				? text + "\n"
				: jsx`<${Raw} value=${highlighted + "\n"} />`;
		return jsx`<pre><code class=${className}>${content}</code></pre>`;
	},
};

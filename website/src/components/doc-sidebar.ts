import {jsx} from "@b9g/crank/standalone";
import {css} from "@emotion/css";
import type {DocInfo} from "../models/document.js";

// Define the category structure for Shovel docs
const DOC_CATEGORIES: Array<{
	name: string;
	slug: string;
	items: string[]; // slugs of docs in this category
}> = [
	{
		name: "Core",
		slug: "core",
		items: ["cli", "shovel-json", "serviceworker"],
	},
	{
		name: "@b9g/router",
		slug: "router",
		items: ["router", "middleware"],
	},
	{
		name: "Storage",
		slug: "storage",
		items: ["cache", "filesystem", "zen", "cookies"],
	},
	{
		name: "Utilities",
		slug: "utilities",
		items: ["http-errors", "assets", "logging", "async-context"],
	},
];

interface DocCategory {
	name: string;
	slug: string;
	items: Array<{
		title: string;
		url: string;
		slug: string;
	}>;
}

export function buildDocCategories(docs: DocInfo[]): DocCategory[] {
	const docMap = new Map<string, DocInfo>();
	for (const doc of docs) {
		// Extract slug from URL (e.g., "/caches" -> "caches")
		const slug = doc.url.replace(/^\//, "").replace(/\/$/, "");
		docMap.set(slug, doc);
	}

	return DOC_CATEGORIES.map((category) => ({
		name: category.name,
		slug: category.slug,
		items: category.items
			.map((slug) => {
				const doc = docMap.get(slug);
				if (!doc) return null;
				return {
					title: doc.attributes.title,
					url: `/api${doc.url}`,
					slug,
				};
			})
			.filter((item): item is NonNullable<typeof item> => item !== null),
	})).filter((category) => category.items.length > 0);
}

const sidebarStyle = css`
	background-color: var(--bg-color);
	margin-top: 50px;
	padding: 2rem 0.4rem;
	color: var(--text-color);
	border-right: 1px solid currentcolor;
	border-bottom: 1px solid currentcolor;

	@media screen and (min-width: 800px) {
		position: fixed;
		top: 50px;
		bottom: 0;
		overflow-x: hidden;
		overflow-y: auto;
		width: 15rem;
		margin: 0;
		padding: 2rem 1rem;
		text-align: right;
	}

	@media screen and (min-width: 1100px) {
		padding: 3rem 2rem;
		width: 20rem;
	}

	> :first-child {
		margin-top: 0;
	}
`;

const categoryStyle = css`
	font-size: 0.85rem;
	color: var(--highlight-color);
	margin: 1.5rem 0 0.5rem;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	font-weight: bold;

	&:first-of-type {
		margin-top: 0;
	}
`;

const linkStyle = css`
	display: block;
	margin: 0.5rem 0;
	text-decoration: none;
	color: var(--text-color);

	&:hover {
		color: var(--highlight-color);
	}

	&[aria-current="page"] {
		color: var(--highlight-color);
		font-weight: bold;
	}
`;

export function DocSidebar({
	categories,
	url,
}: {
	categories: DocCategory[];
	url: string;
}) {
	return jsx`
		<div id="sidebar" class=${sidebarStyle}>
			<h2 class=${css`
				color: var(--highlight-color);
				margin-top: 0;
			`}>API</h2>
			${categories.map(
				(category) => jsx`
				<div class=${categoryStyle}>${category.name}</div>
				${category.items.map(
					(item) => jsx`
					<a
						href=${item.url}
						class=${linkStyle}
						aria-current=${url.replace(/\/$/, "") === item.url.replace(/\/$/, "") && "page"}
					>${item.title}</a>
				`,
				)}
			`,
			)}
		</div>
	`;
}

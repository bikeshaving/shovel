import {jsx} from "@b9g/crank/standalone";
import {css} from "@emotion/css";
import type {DocInfo} from "../models/document.js";

// Category order - categories not listed here appear at the end alphabetically
const CATEGORY_ORDER = [
	"shovel",
	"@b9g/router",
];

// Map slugs to categories (for docs where title doesn't indicate category)
const SLUG_TO_CATEGORY: Record<string, string> = {
	cli: "shovel",
	"shovel-json": "shovel",
	serviceworker: "shovel",
	router: "@b9g/router",
	middleware: "@b9g/router",
	cache: "@b9g/cache",
	logging: "@logtape/logtape",
};

function getCategoryFromTitle(title: string): string | null {
	// Match package names like @b9g/router or @logtape/logtape
	const match = title.match(/^@[\w-]+\/[\w-]+/);
	return match ? match[0] : null;
}

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
	const categories = new Map<string, DocCategory>();

	for (const doc of docs) {
		const slug = doc.url.replace(/^\//, "").replace(/\/$/, "");
		const title = doc.attributes.title;

		// Determine category: explicit mapping > title parsing
		let categoryName = SLUG_TO_CATEGORY[slug] || getCategoryFromTitle(title);
		if (!categoryName) {
			categoryName = "Other";
		}

		if (!categories.has(categoryName)) {
			categories.set(categoryName, {
				name: categoryName,
				slug: categoryName.replace(/[@/]/g, ""),
				items: [],
			});
		}

		categories.get(categoryName)!.items.push({
			title,
			url: `/api${doc.url}`,
			slug,
		});
	}

	// Sort items within each category alphabetically
	for (const category of categories.values()) {
		category.items.sort((a, b) => a.title.localeCompare(b.title));
	}

	// Sort categories: ordered ones first, then alphabetically
	const result = Array.from(categories.values()).sort((a, b) => {
		const aIndex = CATEGORY_ORDER.indexOf(a.name);
		const bIndex = CATEGORY_ORDER.indexOf(b.name);
		if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
		if (aIndex !== -1) return -1;
		if (bIndex !== -1) return 1;
		return a.name.localeCompare(b.name);
	});

	return result;
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

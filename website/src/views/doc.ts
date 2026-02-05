import {jsx} from "@b9g/crank/standalone";
import * as Path from "path";

import {Root} from "../components/root.js";
import {Main} from "../components/sidebar.js";
import {Marked} from "../components/marked.js";
import {collectDocuments} from "../models/document.js";
import {DocSidebar, buildDocCategories} from "../components/doc-sidebar.js";

interface ViewProps {
	url: string;
	params: Record<string, string>;
}

const __dirname = new URL(".", import.meta.url).pathname;

export default async function Doc({url}: ViewProps) {
	const docs = await collectDocuments(
		Path.join(__dirname, "../../../docs/reference"),
		Path.join(__dirname, "../../../docs/reference"),
	);

	// For sidebar, filter out index.md
	const filteredDocs = docs.filter((doc) => doc.url !== "/index");

	// Find the doc - /api shows index, /api/:slug shows that doc
	const isIndex = url.replace(/\/$/, "") === "/api";
	const post = isIndex
		? docs.find((doc) => doc.url === "/index")
		: filteredDocs.find(
				(doc) => `/api${doc.url}`.replace(/\/$/, "") === url.replace(/\/$/, ""),
			);
	if (!post) {
		throw new Error("Doc not found");
	}

	const categories = buildDocCategories(filteredDocs);

	const {
		attributes: {title, description},
		body,
	} = post;
	return jsx`
		<${Root} title="Shovel | ${title}" url=${url} description=${description}>
			<${DocSidebar} categories=${categories} url=${url} />
			<${Main}>
				<${Marked} markdown=${body} />
			<//Main>
		<//Root>
	`;
}

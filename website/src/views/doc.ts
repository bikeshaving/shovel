import {jsx} from "@b9g/crank/standalone";
import * as Path from "path";

import {Root} from "../components/root.js";
import {Main, Sidebar} from "../components/sidebar.js";
import {Marked} from "../components/marked.js";
import {collectDocuments} from "../models/document.js";

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

	// Filter out index.md
	const filteredDocs = docs.filter((doc) => doc.url !== "/index");

	const post = filteredDocs.find(
		(doc) => `/docs${doc.url}`.replace(/\/$/, "") === url.replace(/\/$/, ""),
	);
	if (!post) {
		throw new Error("Doc not found");
	}

	const {
		attributes: {title, description},
		body,
	} = post;
	return jsx`
		<${Root} title="Shovel | ${title}" url=${url} description=${description}>
			<${Sidebar} docs=${filteredDocs} url=${url} title="Reference" urlPrefix="/docs" />
			<${Main}>
				<${Marked} markdown=${body} />
			<//Main>
		<//Root>
	`;
}

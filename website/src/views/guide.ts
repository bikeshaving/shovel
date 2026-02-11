import {jsx} from "@b9g/crank/standalone";
import * as Path from "path";
import {NotFound} from "@b9g/http-errors";

import {Root} from "../components/root.js";
import {Main, Sidebar} from "../components/sidebar.js";
import {Marked} from "../components/marked.js";
import {collectDocuments} from "../models/document.js";

interface ViewProps {
	url: string;
	params: Record<string, string>;
}

const __dirname = new URL(".", import.meta.url).pathname;

export default async function Guide({url}: ViewProps) {
	const docs = await collectDocuments(
		Path.join(__dirname, "../../../docs/guides"),
		Path.join(__dirname, "../../../docs/"),
	);

	const post = docs.find(
		(doc) => doc.url.replace(/\/$/, "") === url.replace(/\/$/, ""),
	);
	if (!post) {
		throw new NotFound("Guide not found");
	}

	const {
		attributes: {title, description},
		body,
	} = post;
	return jsx`
		<${Root} title="Shovel | ${title}" url=${url} description=${description}>
			<${Sidebar} docs=${docs} url=${url} title="Guides" />
			<${Main}>
				<h1>${title}</h1>
				<${Marked} markdown=${body} linkBase="guides" />
			<//Main>
		<//Root>
	`;
}

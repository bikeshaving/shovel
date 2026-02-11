import {jsx} from "@b9g/crank/standalone";
import {NotFound} from "@b9g/http-errors";

import {Root} from "../components/root.js";
import {Main, Sidebar} from "../components/sidebar.js";
import {Marked} from "../components/marked.js";
import {collectDocuments} from "../models/document.js";

interface ViewProps {
	url: string;
	params: Record<string, string>;
}

export default async function Guide({url}: ViewProps) {
	const docsDir = await self.directories.open("docs");
	const guidesDir = await docsDir.getDirectoryHandle("guides");
	const docs = await collectDocuments(guidesDir, {pathPrefix: "guides"});

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

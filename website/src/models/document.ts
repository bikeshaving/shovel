import FS from "fs/promises";
import type {Stats} from "fs";
import * as Path from "path";
import frontmatter from "front-matter";

interface WalkInfo {
	filename: string;
	stats: Stats;
}

async function* walk(dir: string): AsyncGenerator<WalkInfo> {
	const files = (await FS.readdir(dir)).sort();
	for (let filename of files) {
		filename = Path.join(dir, filename);
		const stats = await FS.stat(filename);
		if (stats.isDirectory()) {
			yield* walk(filename);
		} else if (stats.isFile()) {
			yield {filename, stats};
		}
	}
}

export interface DocInfo {
	attributes: {
		title: string;
		publish: boolean;
		description?: string;
	};
	url: string;
	filename: string;
	body: string;
}

export async function collectDocuments(
	pathname: string,
	rootPathname: string = pathname,
	options: {shallow?: boolean} = {},
): Promise<Array<DocInfo>> {
	const docs: Array<DocInfo> = [];
	for await (const {filename} of walk(pathname)) {
		if (filename.endsWith(".md")) {
			// Skip subdirectories in shallow mode
			if (options.shallow) {
				const relative = Path.relative(pathname, filename);
				if (relative.includes(Path.sep)) {
					continue;
				}
			}

			const md = await FS.readFile(filename, {encoding: "utf8"});
			const {attributes, body} = frontmatter(md) as unknown as DocInfo;
			attributes.publish =
				attributes.publish == null ? true : attributes.publish;

			// If no title in frontmatter, extract from first heading
			if (!attributes.title) {
				const match = body.match(/^#\s+(.+)$/m);
				if (match) {
					attributes.title = match[1];
				}
			}

			const url = Path.join("/", Path.relative(rootPathname, filename))
				.replace(/\.md$/, "")
				.replace(/([0-9]+-)+/, "");
			docs.push({url, filename, body, attributes});
		}
	}

	docs.sort((a, b) => {
		const relA = Path.relative(rootPathname, a.filename);
		const relB = Path.relative(rootPathname, b.filename);
		const guidePrefix = `guides${Path.sep}`;
		const isGuideA = relA.startsWith(guidePrefix);
		const isGuideB = relB.startsWith(guidePrefix);

		if (isGuideA !== isGuideB) {
			return isGuideA ? -1 : 1;
		}

		if (isGuideA && isGuideB) {
			const baseA = Path.basename(relA);
			const baseB = Path.basename(relB);
			const matchA = baseA.match(/^(\d+)-/);
			const matchB = baseB.match(/^(\d+)-/);
			if (matchA && matchB) {
				const orderA = parseInt(matchA[1], 10);
				const orderB = parseInt(matchB[1], 10);
				if (orderA !== orderB) {
					return orderA - orderB;
				}
			}
		}

		return relA.localeCompare(relB);
	});

	return docs;
}

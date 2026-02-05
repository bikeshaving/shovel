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

export interface BlogPost {
	attributes: {
		title: string;
		description?: string;
		date: string;
		author?: string;
		authorURL?: string;
		publish: boolean;
	};
	url: string;
	filename: string;
	body: string;
}

export async function collectBlogPosts(
	pathname: string,
): Promise<Array<BlogPost>> {
	const posts: Array<BlogPost> = [];

	for await (const {filename} of walk(pathname)) {
		if (filename.endsWith(".md")) {
			const md = await FS.readFile(filename, {encoding: "utf8"});
			const {attributes, body} = frontmatter(md) as unknown as BlogPost;
			attributes.publish =
				attributes.publish == null ? true : attributes.publish;

			// Extract slug from filename (e.g., 2025-01-introducing-shovel.md -> introducing-shovel)
			const basename = Path.basename(filename, ".md");
			const slug = basename.replace(/^\d{4}-\d{2}-/, "");
			const url = `/blog/${slug}`;

			posts.push({url, filename, body, attributes});
		}
	}

	// Sort by date descending (newest first)
	posts.sort((a, b) => {
		const dateA = new Date(a.attributes.date).getTime();
		const dateB = new Date(b.attributes.date).getTime();
		return dateB - dateA;
	});

	return posts;
}

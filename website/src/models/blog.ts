import frontmatter from "front-matter";

interface WalkInfo {
	filename: string;
}

async function* walk(
	dir: FileSystemDirectoryHandle,
	basePath: string = "",
): AsyncGenerator<WalkInfo> {
	const entries: Array<[string, FileSystemHandle]> = [];
	for await (const entry of dir.entries()) {
		entries.push(entry);
	}

	entries.sort((a, b) => a[0].localeCompare(b[0]));

	for (const [name, handle] of entries) {
		const path = basePath ? `${basePath}/${name}` : name;
		if (handle.kind === "directory") {
			yield* walk(handle as FileSystemDirectoryHandle, path);
		} else {
			yield {filename: path};
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
	dir: FileSystemDirectoryHandle,
): Promise<Array<BlogPost>> {
	const posts: Array<BlogPost> = [];

	for await (const {filename} of walk(dir)) {
		if (filename.endsWith(".md")) {
			// Navigate to the file handle
			const parts = filename.split("/");
			let current: FileSystemDirectoryHandle = dir;
			for (let i = 0; i < parts.length - 1; i++) {
				current = await current.getDirectoryHandle(parts[i]);
			}

			const fileHandle = await current.getFileHandle(parts[parts.length - 1]);
			const file = await fileHandle.getFile();
			const md = await file.text();
			const {attributes, body} = frontmatter(md) as unknown as BlogPost;
			attributes.publish =
				attributes.publish == null ? true : attributes.publish;

			// Extract slug from filename (e.g., 2025-01-introducing-shovel.md -> introducing-shovel)
			const basename = filename.split("/").pop()!.replace(/\.md$/, "");
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

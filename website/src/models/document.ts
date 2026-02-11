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

async function navigatePath(
	dir: FileSystemDirectoryHandle,
	path: string,
): Promise<FileSystemFileHandle> {
	const parts = path.split("/");
	let current: FileSystemDirectoryHandle = dir;
	for (let i = 0; i < parts.length - 1; i++) {
		current = await current.getDirectoryHandle(parts[i]);
	}

	return current.getFileHandle(parts[parts.length - 1]);
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
	dir: FileSystemDirectoryHandle,
	options: {shallow?: boolean; pathPrefix?: string} = {},
): Promise<Array<DocInfo>> {
	const docs: Array<DocInfo> = [];
	for await (const {filename} of walk(dir)) {
		if (filename.endsWith(".md")) {
			// Skip subdirectories in shallow mode
			if (options.shallow && filename.includes("/")) {
				continue;
			}

			const fileHandle = await navigatePath(dir, filename);
			const file = await fileHandle.getFile();
			const md = await file.text();
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

			const prefixedFilename = options.pathPrefix
				? `${options.pathPrefix}/${filename}`
				: filename;
			const url = ("/" + prefixedFilename)
				.replace(/\.md$/, "")
				.replace(/([0-9]+-)+/, "");
			docs.push({url, filename: prefixedFilename, body, attributes});
		}
	}

	docs.sort((a, b) => {
		const isGuideA = a.filename.startsWith("guides/");
		const isGuideB = b.filename.startsWith("guides/");

		if (isGuideA !== isGuideB) {
			return isGuideA ? -1 : 1;
		}

		if (isGuideA && isGuideB) {
			const baseA = a.filename.split("/").pop()!;
			const baseB = b.filename.split("/").pop()!;
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

		return a.filename.localeCompare(b.filename);
	});

	return docs;
}

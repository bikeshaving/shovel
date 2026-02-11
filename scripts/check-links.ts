/* eslint-disable no-console, no-restricted-syntax */
/**
 * Crawl shovel.js.org (or a local dev server) and report broken links.
 *
 * Usage:
 *   bun scripts/check-links.ts [base-url]
 *
 * Defaults to https://shovel.js.org if no URL is provided.
 */

const baseURL = process.argv[2] || "https://shovel.js.org";
const origin = new URL(baseURL).origin;

const visited = new Set<string>();
const queue: Array<{url: string; source: string}> = [];
const broken: Array<{url: string; status: number; source: string}> = [];

queue.push({url: baseURL, source: "(start)"});

while (queue.length > 0) {
	const {url, source} = queue.shift()!;
	if (visited.has(url)) continue;
	visited.add(url);

	try {
		const res = await fetch(url, {redirect: "follow"});
		if (!res.ok) {
			broken.push({url, status: res.status, source});
			continue;
		}

		const contentType = res.headers.get("content-type") || "";
		if (!contentType.includes("text/html")) continue;

		const html = await res.text();
		// Match <a href="..."> links only (skip href in code blocks / other elements)
		const linkRegex = /<a\s[^>]*?href="([^"]*?)"/g;
		let match;
		while ((match = linkRegex.exec(html)) !== null) {
			let href = match[1];
			if (
				!href ||
				href.startsWith("#") ||
				href.startsWith("mailto:") ||
				href.startsWith("javascript:")
			)
				continue;

			// Resolve relative URLs
			let resolved: string;
			try {
				resolved = new URL(href, url).href;
			} catch {
				continue;
			}

			// Strip fragments
			resolved = resolved.split("#")[0];

			// Only crawl same-origin links
			if (!resolved.startsWith(origin)) continue;
			if (!visited.has(resolved)) {
				queue.push({url: resolved, source: url});
			}
		}
	} catch (err: any) {
		broken.push({url, status: 0, source: `${source} (${err.message})`});
	}
}

console.log(`\nCrawled ${visited.size} URLs`);
if (broken.length === 0) {
	console.log("No broken links found!");
} else {
	console.log(`\n${broken.length} broken link(s):\n`);
	for (const {url, status, source} of broken) {
		console.log(`  ${status} ${url}`);
		console.log(`    <- ${source}\n`);
	}
	process.exit(1);
}

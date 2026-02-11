/** @jsxImportSource @b9g/crank */
import {css} from "@emotion/css";
import {NotFound} from "@b9g/http-errors";

import {Root} from "../components/root.js";
import {Marked} from "../components/marked.js";
import {collectBlogPosts} from "../models/blog.js";

interface ViewProps {
	url: string;
	params: Record<string, string>;
}

const articleStyles = css`
	max-width: 800px;
	margin: 0 auto;
	padding: 2rem 1rem;

	@media screen and (min-width: 800px) {
		padding: 3rem 2rem;
		margin-top: 50px;
	}

	p {
		line-height: 1.7;
	}

	pre {
		background: var(--code-bg);
		padding: 1rem;
		border-radius: 4px;
		overflow-x: auto;
	}

	code {
		font-family: "SF Mono", Menlo, Monaco, "Courier New", monospace;
		font-size: 0.9em;
	}

	code.inline {
		background: var(--code-bg);
		padding: 0.2em 0.4em;
		border-radius: 3px;
	}
`;

const metaStyles = css`
	color: var(--text-muted);
	margin-bottom: 2rem;
	font-size: 0.95rem;
`;

const backLinkStyles = css`
	display: inline-block;
	margin-bottom: 2rem;
	color: var(--highlight-color);
	text-decoration: none;

	&:hover {
		text-decoration: underline;
	}
`;

export default async function BlogPostView({url}: ViewProps) {
	const docsDir = await self.directories.open("docs");
	const blogDir = await docsDir.getDirectoryHandle("blog");
	const posts = await collectBlogPosts(blogDir);

	const post = posts.find(
		(p) => p.url.replace(/\/$/, "") === url.replace(/\/$/, ""),
	);

	if (!post) {
		throw new NotFound("Blog post not found");
	}

	const {
		attributes: {title, description, date, author, authorURL},
		body,
	} = post;

	const formattedDate = new Date(date).toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		timeZone: "UTC",
	});

	return (
		<Root title={`Shovel | ${title}`} url={url} description={description}>
			<article class={articleStyles}>
				<a href="/blog" class={backLinkStyles}>
					&larr; Back to Blog
				</a>
				<h1>{title}</h1>
				<p class={metaStyles}>
					{formattedDate}
					{author && authorURL ? (
						<>
							{" "}
							by <a href={authorURL}>{author}</a>
						</>
					) : author ? (
						<> by {author}</>
					) : null}
				</p>
				<Marked markdown={body} />
			</article>
		</Root>
	);
}

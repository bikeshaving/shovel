/** @jsxImportSource @b9g/crank */
import {css} from "@emotion/css";
import * as Path from "path";

import {Root} from "../components/root.js";
import {collectBlogPosts} from "../models/blog.js";

interface ViewProps {
	url: string;
}

const containerStyles = css`
	max-width: 800px;
	margin: 0 auto;
	padding: 2rem 1rem;

	@media screen and (min-width: 800px) {
		padding: 3rem 2rem;
		margin-top: 50px;
	}
`;

const postListStyles = css`
	list-style: none;
	padding: 0;
	margin: 2rem 0;
`;

const postItemStyles = css`
	margin-bottom: 2.5rem;
	padding-bottom: 2rem;
	border-bottom: 1px solid var(--border-color);

	&:last-child {
		border-bottom: none;
	}
`;

const postTitleStyles = css`
	margin: 0 0 0.5rem;
	font-size: 1.5rem;

	a {
		color: var(--text-color);
		text-decoration: none;

		&:hover {
			color: var(--highlight-color);
		}
	}
`;

const postMetaStyles = css`
	color: var(--text-muted);
	font-size: 0.9rem;
	margin-bottom: 0.75rem;
`;

const postDescriptionStyles = css`
	color: var(--text-color);
	line-height: 1.6;
	margin: 0;
`;

const __dirname = new URL(".", import.meta.url).pathname;

export default async function BlogListView({url}: ViewProps) {
	const posts = await collectBlogPosts(
		Path.join(__dirname, "../../../docs/blog"),
	);

	const publishedPosts = posts.filter((p) => p.attributes.publish);

	return (
		<Root
			title="Shovel | Blog"
			url={url}
			description="News and updates from the Shovel team."
		>
			<div class={containerStyles}>
				<h1>Blog</h1>
				<ul class={postListStyles}>
					{publishedPosts.map((post) => {
						const formattedDate = new Date(
							post.attributes.date,
						).toLocaleDateString("en-US", {
							year: "numeric",
							month: "long",
							day: "numeric",
						});

						return (
							<li class={postItemStyles}>
								<h2 class={postTitleStyles}>
									<a href={post.url}>{post.attributes.title}</a>
								</h2>
								<p class={postMetaStyles}>
									{formattedDate}
									{post.attributes.author
										? ` by ${post.attributes.author}`
										: ""}
								</p>
								{post.attributes.description && (
									<p class={postDescriptionStyles}>
										{post.attributes.description}
									</p>
								)}
							</li>
						);
					})}
				</ul>
			</div>
		</Root>
	);
}

import {jsx} from "@b9g/crank/standalone";
import {css} from "@emotion/css";

const navbarStyles = css`
	position: fixed;
	top: 0;
	left: 0;
	right: 0;
	height: 50px;
	background-color: var(--bg-color);
	border-bottom: 1px solid var(--text-color);
	display: flex;
	align-items: center;
	padding: 0 1rem;
	z-index: 100;
`;

const logoStyles = css`
	font-size: 1.5rem;
	font-weight: bold;
	color: var(--highlight-color);
	text-decoration: none;
`;

const navLinksStyles = css`
	display: flex;
	gap: 1.5rem;
	margin-left: auto;

	a {
		color: var(--text-color);
		text-decoration: none;
		&:hover {
			color: var(--highlight-color);
		}
		&[aria-current="page"] {
			color: var(--highlight-color);
		}
	}
`;

export function Navbar({url}: {url: string}) {
	return jsx`
		<nav class=${navbarStyles}>
			<a href="/" class=${logoStyles}>Shovel</a>
			<div class=${navLinksStyles}>
				<a href="/guides/getting-started" aria-current=${url.startsWith("/guides") ? "page" : undefined}>Guides</a>
				<a href="/docs/routing" aria-current=${url.startsWith("/docs") ? "page" : undefined}>Reference</a>
				<a href="/blog" aria-current=${url.startsWith("/blog") ? "page" : undefined}>Blog</a>
				<a href="https://github.com/bikeshaving/shovel">GitHub</a>
			</div>
		</nav>
	`;
}

import {jsx} from "@b9g/crank/standalone";
import {css} from "@emotion/css";
import {Root} from "../components/root.js";

interface ViewProps {
	url: string;
}

const containerStyles = css`
	min-height: 100vh;
	display: flex;
	flex-direction: column;
	justify-content: center;
	align-items: center;
	text-align: center;
	padding: 60px 1rem 2rem;
`;

const codeStyles = css`
	font-size: clamp(4rem, 15vw, 8rem);
	font-weight: 700;
	color: var(--text-muted);
	margin: 0;
	line-height: 1;
	opacity: 0.3;
`;

const messageStyles = css`
	color: var(--text-color);
	font-size: clamp(1.25rem, 3vw, 1.5rem);
	margin: 1rem 0 2rem;
`;

const linksStyles = css`
	display: flex;
	gap: 1rem;

	a {
		display: inline-block;
		padding: 0.6em 1.2em;
		border: 1px solid var(--text-muted);
		color: var(--highlight-color);
		text-decoration: none;
		font-size: 0.95rem;
		border-radius: 4px;
		&:hover {
			background: var(--highlight-color);
			color: var(--bg-color);
			border-color: var(--highlight-color);
		}
	}
`;

export default function NotFoundView({url}: ViewProps) {
	return jsx`
		<${Root}
			title="404 - Page Not Found"
			url=${url}
			description="The page you're looking for doesn't exist."
		>
			<div class=${containerStyles}>
				<p class=${codeStyles}>404</p>
				<p class=${messageStyles}>This page doesn't exist.</p>
				<div class=${linksStyles}>
					<a href="/">Home</a>
					<a href="/guides/getting-started">Guides</a>
					<a href="/api">API Reference</a>
				</div>
			</div>
		<//Root>
	`;
}

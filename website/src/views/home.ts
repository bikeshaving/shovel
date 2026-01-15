import {jsx} from "@b9g/crank/standalone";
import {css} from "@emotion/css";
import {Root} from "../components/root.js";

interface ViewProps {
	url: string;
}

const heroStyles = css`
	height: 100vh;
	width: 100%;
	display: flex;
	flex-direction: column;
	justify-content: center;
	align-items: center;
	text-align: center;
	margin-top: 50px;
`;

const titleStyles = css`
	color: var(--highlight-color);
	font-size: max(40px, 10vw);
	margin: 0.3em 0;
`;

const subtitleStyles = css`
	color: var(--text-color);
	font-size: max(20px, 3vw);
	margin: 0.5em;
	max-width: 800px;
	padding: 0 1rem;
`;

const ctaStyles = css`
	margin-top: 2rem;
	display: flex;
	gap: 1rem;
	flex-wrap: wrap;
	justify-content: center;

	a {
		display: inline-block;
		padding: 0.8em 1.5em;
		border: 1px solid var(--text-color);
		color: var(--highlight-color);
		text-decoration: none;
		font-size: 1.1rem;
		&:hover {
			background: var(--highlight-color);
			color: var(--bg-color);
		}
	}
`;

export default function Home({url}: ViewProps) {
	return jsx`
		<${Root}
			title="Shovel - ServiceWorker-first Universal Deployment"
			url=${url}
			description="Write ServiceWorker apps once, deploy anywhere. Node, Bun, Cloudflare Workers."
		>
			<div class=${heroStyles}>
				<h1 class=${titleStyles}>Shovel</h1>
				<p class=${subtitleStyles}>
					The ServiceWorker-first universal deployment platform.
					Write once, deploy anywhere.
				</p>
				<div class=${ctaStyles}>
					<a href="/guides/getting-started">Get Started</a>
					<a href="https://github.com/bikeshaving/shovel">GitHub</a>
				</div>
			</div>
		<//Root>
	`;
}

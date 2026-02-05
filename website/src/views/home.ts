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

const codeBlockStyles = css`
	background: var(--code-bg);
	border-radius: 8px;
	padding: 1.5rem 2rem;
	margin: 2rem 1rem;
	text-align: left;
	max-width: 600px;
	width: 100%;
	overflow-x: auto;

	pre {
		margin: 0;
		font-family: "SF Mono", Menlo, Monaco, "Courier New", monospace;
		font-size: 0.95rem;
		line-height: 1.5;
		color: var(--text-color);
	}
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
			title="Shovel - Run Service Workers Everywhere"
			url=${url}
			description="Run Service Workers anywhere Node, Bun, Cloudflare Workers."
		>
			<div class=${heroStyles}>
				<h1 class=${titleStyles}>Shovel</h1>
				<p class=${subtitleStyles}>
					Run Service Workers anywhere
				</p>
				<div class=${codeBlockStyles}>
					<pre>${`import {Router} from "@b9g/router";

const router = new Router();

router.route("/").get(() => new Response("Hello World"));

router.route("/api/users/:id").get(async (req, ctx) => {
  const db = self.databases.get("main");
  const user = await db.get\`
    SELECT * FROM users WHERE id = \${ctx.params.id}
  \`;
  return Response.json(user);
});

self.addEventListener("fetch", (ev) => {
  ev.respondWith(router.handle(ev.request));
});`}</pre>
				</div>
				<div class=${ctaStyles}>
					<a href="/guides/getting-started">Get Started</a>
					<a href="https://github.com/bikeshaving/shovel">GitHub</a>
				</div>
			</div>
		<//Root>
	`;
}

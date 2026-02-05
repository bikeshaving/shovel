import {jsx, Raw} from "@b9g/crank/standalone";
import {css} from "@emotion/css";
import {Root} from "../components/root.js";
import {highlight} from "../utils/prism.js";

interface ViewProps {
	url: string;
}

const heroStyles = css`
	min-height: 100vh;
	width: 100%;
	display: flex;
	flex-direction: column;
	justify-content: center;
	align-items: center;
	text-align: center;
	padding: 2rem 1rem;
	box-sizing: border-box;
`;

const titleStyles = css`
	color: var(--highlight-color);
	font-size: clamp(2.5rem, 8vw, 5rem);
	margin: 0;
`;

const subtitleStyles = css`
	color: var(--text-muted);
	font-size: clamp(1rem, 2.5vw, 1.25rem);
	margin: 0.5rem 0 2rem;
`;

const codeContainerStyles = css`
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 1.5rem;
	width: 100%;
	max-width: 1100px;

	@media (max-width: 900px) {
		grid-template-columns: 1fr;
		max-width: 600px;
	}
`;

const codeBlockStyles = css`
	background: var(--code-bg);
	border-radius: 8px;
	padding: 1.25rem 1.5rem;
	text-align: left;

	pre {
		margin: 0;
		font-family: "SF Mono", Menlo, Monaco, "Courier New", monospace;
		font-size: 0.9rem;
		line-height: 1.5;
		white-space: pre;
		overflow: hidden;
	}

	code {
		font-family: inherit;
	}
`;

const codeLabelStyles = css`
	font-size: 0.75rem;
	color: var(--text-muted);
	margin-bottom: 0.75rem;
	text-transform: uppercase;
	letter-spacing: 0.05em;
`;

const ctaStyles = css`
	margin-top: 2rem;
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

const serverCode = `import {Router} from "@b9g/router";

const router = new Router();

router.route("/kv/:key")
  .get(async (req, ctx) => {
    const cache = await self.caches.open("kv");
    const cached = await cache.match(ctx.params.key);
    return cached ?? new Response(null, {status: 404});
  })
  .put(async (req, ctx) => {
    const cache = await self.caches.open("kv");
    await cache.put(ctx.params.key, new Response(await req.text()));
    return new Response(null, {status: 201});
  })
  .delete(async (req, ctx) => {
    const cache = await self.caches.open("kv");
    await cache.delete(ctx.params.key);
    return new Response(null, {status: 204});
  });

self.addEventListener("fetch", (ev) => {
  ev.respondWith(router.handle(ev.request));
});`;

const terminalCode = `$ shovel develop server.ts
listening on http://localhost:3000

$ curl -X PUT :3000/kv/hello -d "world"

$ curl :3000/kv/hello
world

$ curl -X DELETE :3000/kv/hello

$ curl :3000/kv/hello
# 404`;

export default function Home({url}: ViewProps) {
	const highlightedServer = highlight(serverCode, "typescript");
	const highlightedTerminal = highlight(terminalCode, "bash");

	return jsx`
		<${Root}
			title="Shovel.js - Run Service Workers Anywhere"
			url=${url}
			description="Run Service Workers anywhere — Node, Bun, Cloudflare Workers."
		>
			<div class=${heroStyles}>
				<h1 class=${titleStyles}>Shovel.js</h1>
				<p class=${subtitleStyles}>
					Run Service Workers anywhere
				</p>
				<div class=${codeContainerStyles}>
					<div class=${codeBlockStyles}>
						<div class=${codeLabelStyles}>server.ts</div>
						<pre><code><${Raw} value=${highlightedServer} /></code></pre>
					</div>
					<div class=${codeBlockStyles}>
						<div class=${codeLabelStyles}>terminal</div>
						<pre><code><${Raw} value=${highlightedTerminal} /></code></pre>
					</div>
				</div>
				<div class=${ctaStyles}>
					<a href="/guides/getting-started">Get Started</a>
					<a href="https://github.com/bikeshaving/shovel">GitHub</a>
				</div>
			</div>
		<//Root>
	`;
}

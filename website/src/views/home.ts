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
	padding: 60px 1rem 2rem;
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
  .get(async (req) => {
    const cache = await self.caches.open("kv");
    const cached = await cache.match(req.url);
    return cached ?? new Response(null, {status: 404});
  })
  .put(async (req) => {
    const cache = await self.caches.open("kv");
    await cache.put(req.url, new Response(await req.text()));
    return new Response(null, {status: 201});
  })
  .delete(async (req) => {
    const cache = await self.caches.open("kv");
    await cache.delete(req.url);
    return new Response(null, {status: 204});
  });

self.addEventListener("fetch", (ev) => {
  ev.respondWith(router.handle(ev.request));
});`;

// Offsets in ms from page load, matching realistic shovel develop timing
const logLines = [
	{offset: 0, rest: " INF shovel\u00b7build Building..."},
	{offset: 35, rest: " INF shovel\u00b7build Build complete in 35ms"},
	{
		offset: 109,
		rest: " INF shovel\u00b7build Watching 27 files in 9 directories",
	},
	{offset: 147, rest: " INF shovel\u00b7platform Server ready"},
	{offset: 147, rest: " INF shovel\u00b7develop http://localhost:7777"},
];

function buildTerminalHtml(): string {
	const lines: string[] = [];
	lines.push("$ shovel develop server.ts");
	for (const {offset, rest} of logLines) {
		lines.push(`<span data-ts-offset="${offset}"></span>${escapeHtml(rest)}`);
	}
	lines.push("");
	lines.push("$ curl -X PUT :7777/kv/hello -d &quot;world&quot;");
	lines.push("# 201");
	lines.push("$ curl :7777/kv/hello");
	lines.push("world");
	lines.push("$ curl -X DELETE :7777/kv/hello");
	lines.push("# 204");
	return lines.join("\n");
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const timestampScript = `<script>
(function() {
  var now = new Date();
  var h = String(now.getHours()).padStart(2, "0");
  var m = String(now.getMinutes()).padStart(2, "0");
  var s = String(now.getSeconds()).padStart(2, "0");
  var ms = now.getMilliseconds();
  var spans = document.querySelectorAll("[data-ts-offset]");
  for (var i = 0; i < spans.length; i++) {
    var offset = parseInt(spans[i].getAttribute("data-ts-offset"), 10);
    var total = ms + offset;
    var extraS = Math.floor(total / 1000);
    var finalMs = String(total % 1000).padStart(3, "0");
    var finalS = parseInt(s, 10) + extraS;
    var finalM = parseInt(m, 10) + Math.floor(finalS / 60);
    finalS = String(finalS % 60).padStart(2, "0");
    finalM = String(finalM % 60).padStart(2, "0");
    spans[i].textContent = h + ":" + finalM + ":" + finalS + "." + finalMs;
  }
})();
</script>`;

export default function Home({url}: ViewProps) {
	const highlightedServer = highlight(serverCode, "typescript");
	const terminalHtml = buildTerminalHtml();

	return jsx`
		<${Root}
			title="Shovel.js - The Portable Meta-Framework"
			url=${url}
			description="The portable meta-framework built on web standards. Run Service Workers anywhere — Node, Bun, Cloudflare Workers."
		>
			<div class=${heroStyles}>
				<h1 class=${titleStyles}>Shovel.js</h1>
				<p class=${subtitleStyles}>
					The portable meta-framework built on web standards
				</p>
				<div class=${codeContainerStyles}>
					<div class=${codeBlockStyles}>
						<div class=${codeLabelStyles}>server.ts</div>
						<pre><code><${Raw} value=${highlightedServer} /></code></pre>
					</div>
					<div class=${codeBlockStyles}>
						<div class=${codeLabelStyles}>terminal</div>
						<pre><code><${Raw} value=${terminalHtml} /></code></pre>
					</div>
				</div>
				<div class=${ctaStyles}>
					<a href="/guides/getting-started">Get Started</a>
					<a href="https://github.com/bikeshaving/shovel">GitHub</a>
				</div>
			</div>
			<${Raw} value=${timestampScript} />
		<//Root>
	`;
}

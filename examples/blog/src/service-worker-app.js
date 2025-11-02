/**
 * ServiceWorker-style Shovel app entrypoint
 *
 * This file demonstrates the new ServiceWorker-based approach where the
 * entrypoint uses standard ServiceWorker APIs (install, activate, fetch)
 * but runs universally across all platforms.
 */

import {Router} from "@b9g/router";
import {createAssetsMiddleware} from "@b9g/assets";

// Import static assets
import styles from "./assets/styles.css" with {url: "/assets/"};
import logo from "./assets/logo.svg" with {url: "/assets/"};

// Sample blog data
const posts = [
	{
		id: 1,
		title: "ServiceWorker-Style Shovel Apps!",
		content:
			"This app uses ServiceWorker APIs (install, activate, fetch) as its entrypoint. The same code runs in browsers as a real ServiceWorker and on servers with a ServiceWorker runtime shim.",
		author: "Shovel Team",
		date: "2024-01-15",
	},
	{
		id: 2,
		title: "Universal Event-Driven Architecture",
		content:
			"Events like install/activate handle app lifecycle, while fetch handles requests. This makes deployment, hot reloading, and caching feel natural.",
		author: "Shovel Team",
		date: "2024-01-14",
	},
];

let router;

/**
 * ServiceWorker install event - setup and initialization
 */
self.addEventListener("install", (event) => {
	console.info("[SW] Installing Shovel ServiceWorker app...");

	event.waitUntil(async () => {
		// Initialize router
		router = new Router();

		// Setup assets middleware
		router.use(
			createAssetsMiddleware({
				directory: "assets",
				basePath: "/assets",
				manifestPath: "manifest.json",
				dev: process.env?.NODE_ENV !== "production",
			}),
		);

		// Routes
		router.get("/", handleHomepage);
		router.get("/posts/:id", handlePost);
		router.get("/api/posts", handleApiPosts);
		router.get("/about", handleAbout);

		console.info("[SW] Shovel app installed successfully!");
	});
});

/**
 * ServiceWorker activate event - ready to handle requests
 */
self.addEventListener("activate", (event) => {
	console.info("[SW] Activating Shovel ServiceWorker app...");

	event.waitUntil(async () => {
		// App is ready to serve requests
		console.info("[SW] Shovel app activated and ready!");
	});
});

/**
 * ServiceWorker fetch event - handle HTTP requests
 */
self.addEventListener("fetch", (event) => {
	event.respondWith(router.handler(event.request));
});

/**
 * Static event - provide routes for static site generation
 */
self.addEventListener("static", (event) => {
	console.info(`[SW] Collecting static routes for generation...`);

	event.waitUntil(async () => {
		// Return all routes that should be pre-rendered
		const staticRoutes = [
			"/",
			"/about",
			"/api/posts",
			...posts.map((post) => `/posts/${post.id}`),
		];

		console.info(
			`[SW] Found ${staticRoutes.length} routes for static generation`,
		);
		return staticRoutes;
	});
});

// Route handlers

async function handleHomepage(_request, _context) {
	return new Response(
		renderPage(
			"Home",
			`
    <div class="platform-info">
      <strong>Platform:</strong> ServiceWorker-style entrypoint | 
      <strong>Runtime:</strong> Universal
    </div>
    
    <div class="posts">
      ${posts
				.map(
					(post) => `
        <article class="post">
          <h2><a href="/posts/${post.id}">${post.title}</a></h2>
          <div class="meta">By ${post.author} on ${post.date}</div>
          <p>${post.content}</p>
        </article>
      `,
				)
				.join("")}
    </div>
  `,
		),
		{
			headers: {
				"Content-Type": "text/html",
				"Cache-Control": "public, max-age=300",
			},
		},
	);
}

async function handlePost(_request, _context) {
	const post = posts.find((p) => p.id === parseInt(context.params.id));

	if (!post) {
		return new Response(
			renderPage(
				"Post Not Found",
				`
      <div class="post">
        <h2>Post Not Found</h2>
        <p>The post you're looking for doesn't exist.</p>
        <p><a href="/">← Back to Home</a></p>
      </div>
    `,
			),
			{status: 404, headers: {"Content-Type": "text/html"}},
		);
	}

	return new Response(
		renderPage(
			post.title,
			`
    <article class="post">
      <h2>${post.title}</h2>
      <div class="meta">By ${post.author} on ${post.date}</div>
      <p>${post.content}</p>
      <p><a href="/">← Back to Home</a></p>
    </article>
  `,
		),
		{
			headers: {
				"Content-Type": "text/html",
				"Cache-Control": "public, max-age=600",
			},
		},
	);
}

async function handleApiPosts() {
	// Simulate API delay
	await new Promise((resolve) => setTimeout(resolve, 100));

	return Response.json(
		{
			posts: posts.map((p) => ({
				id: p.id,
				title: p.title,
				author: p.author,
				date: p.date,
			})),
			serviceWorker: true,
			timestamp: new Date().toISOString(),
		},
		{
			headers: {
				"Cache-Control": "public, max-age=180",
			},
		},
	);
}

async function handleAbout(_request, _context) {
	return new Response(
		renderPage(
			"About",
			`
    <div class="post">
      <h2>About ServiceWorker-Style Shovel Apps</h2>
      <p>This app demonstrates Shovel's new ServiceWorker-based entrypoint pattern:</p>
      <ul>
        <li><strong>install</strong> - App setup and initialization</li>
        <li><strong>activate</strong> - Ready to handle requests</li>
        <li><strong>fetch</strong> - Handle HTTP requests universally</li>
        <li><strong>platform</strong> - Receive platform-specific setup</li>
      </ul>
      
      <div class="platform-info">
        <strong>Universal Runtime:</strong> Same code runs as real ServiceWorkers in browsers
        and with ServiceWorker runtime shims on servers.
      </div>
      
      <p><a href="/">← Back to Home</a></p>
    </div>
  `,
		),
		{
			headers: {
				"Content-Type": "text/html",
				"Cache-Control": "public, max-age=3600",
			},
		},
	);
}

// Helper function to render HTML pages
function renderPage(title, content) {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - ServiceWorker Shovel</title>
  <link rel="stylesheet" href="${styles}">
  <link rel="icon" href="${logo}">
</head>
<body>
  <header>
    <img src="${logo}" alt="Shovel" width="48" height="48">
    <h1>ServiceWorker Shovel</h1>
    <p class="subtitle">Universal ServiceWorker-Style Apps</p>
  </header>
  
  <nav>
    <a href="/">Home</a>
    <a href="/about">About</a>
    <a href="/api/posts">API</a>
  </nav>
  
  <main>
    ${content}
  </main>
  
  <footer>
    <p>Built with ❤️ using <strong>Shovel ServiceWorker APIs</strong></p>
    <p><small>Events: install → activate → fetch</small></p>
  </footer>
</body>
</html>`;
}

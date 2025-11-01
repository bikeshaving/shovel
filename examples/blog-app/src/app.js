/**
 * Shovel Blog App - ServiceWorker-style entrypoint
 *
 * This demonstrates the new ServiceWorker-based architecture where the
 * entrypoint uses standard ServiceWorker APIs (install, activate, fetch)
 * but runs universally across all platforms.
 */

import {Router} from "@b9g/router";
import {CacheStorage} from "@b9g/cache/cache-storage";
import {MemoryCache} from "@b9g/cache/memory-cache";
import {createStaticFilesMiddleware} from "@b9g/staticfiles";
import {platformRegistry} from "@b9g/platform";
import {createNodePlatform} from "@b9g/platform-node";

// Import static assets using import attributes
import styles from "./assets/styles.css" with {url: "/static/"};
import logo from "./assets/logo.svg" with {url: "/static/"};

// Register platform for File System Access API support
platformRegistry.register("node", createNodePlatform());

// Set up cache storage with different caches for different content types
const caches = new CacheStorage();
caches.register("pages", () => new MemoryCache("pages", {maxEntries: 100}));
caches.register(
	"api",
	() => new MemoryCache("api", {maxEntries: 50, ttl: 5 * 60 * 1000}),
); // 5 min TTL
caches.register("static", () => new MemoryCache("static"));

// Create router with cache support
const router = new Router({caches});

// Static files middleware - serves from File System Access API storage
router.use(
	createStaticFilesMiddleware({
		filesystem: "static",
		basePath: "/static",
		manifestPath: "manifest.json",
		dev: process.env?.NODE_ENV !== "production",
		cacheControl: process.env?.NODE_ENV === "production" 
			? "public, max-age=31536000, immutable" 
			: "no-cache"
	}),
);

// Global page cache middleware
router.use(pageCache);

// Cache middleware for pages using new generator API
async function* pageCache(request, context) {
	if (request.method !== "GET" || !context.cache) {
		// No caching - just passthrough
		const response = yield request;
		return response;
	}

	const cached = await context.cache.match(request);
	if (cached) {
		// Cache hit - return early with cached response
		cached.headers.set("X-Cache", "HIT");
		return cached;
	}

	// Cache miss - continue to handler
	const response = yield request;
	
	// Cache the response for next time
	if (response.ok) {
		await context.cache.put(request, response.clone());
	}

	response.headers.set("X-Cache", "MISS");
	return response;
}

// Sample blog data
const posts = [
	{
		id: 1,
		title: "Welcome to Shovel!",
		content:
			"Shovel is a cache-first metaframework that makes building fast web apps easy. With its Django-inspired app architecture, you can compose exactly the functionality you need.",
		author: "Shovel Team",
		date: "2024-01-15",
	},
	{
		id: 2,
		title: "Cache-First Architecture",
		content:
			"Every request goes through the cache first. This means your app is fast by default, whether you deploy as SSG, SSR, or SPA.",
		author: "Shovel Team",
		date: "2024-01-14",
	},
	{
		id: 3,
		title: "Static Files Made Easy",
		content:
			'Import any asset with `with { url: "/static/" }` and Shovel handles the rest - content hashing, manifest generation, and optimized serving.',
		author: "Shovel Team",
		date: "2024-01-13",
	},
];

// Routes with cache integration
router
	.route({
		pattern: "/",
		cache: {name: "pages"},
	})
	.get(async (request, context) => {
		return new Response(
			renderPage(
				"Home",
				`
    <div class="cache-info">
      <strong>Cache Status:</strong> ${context.cache ? "Enabled" : "Disabled"} | 
      <strong>Cache Name:</strong> ${context.cache ? "pages" : "N/A"}
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
					"Cache-Control": "public, max-age=300", // 5 minutes
				},
			},
		);
	});

router
	.route({
		pattern: "/posts/:id",
		cache: {name: "pages"},
	})
	.get(async (request, context) => {
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
    <div class="cache-info">
      <strong>Cache Status:</strong> ${context.cache ? "Enabled" : "Disabled"} | 
      <strong>Post ID:</strong> ${post.id}
    </div>
    
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
					"Cache-Control": "public, max-age=600", // 10 minutes
				},
			},
		);
	});

// API route with separate cache
router
	.route({
		pattern: "/api/posts",
		cache: {name: "api"},
	})
	.get(async (request, context) => {
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
				cached: !!context.cache,
				timestamp: new Date().toISOString(),
			},
			{
				headers: {
					"Cache-Control": "public, max-age=180", // 3 minutes
				},
			},
		);
	});

// About page
router
	.route({
		pattern: "/about",
		cache: {name: "pages"},
	})
	.get(async (request, context) => {
		return new Response(
			renderPage(
				"About",
				`
    <div class="post">
      <h2>About This App</h2>
      <p>This is a demo blog built with Shovel's cache-first architecture. It showcases:</p>
      <ul>
        <li><strong>@b9g/router</strong> - Universal request routing with middleware</li>
        <li><strong>@b9g/cache</strong> - Multiple cache strategies (pages, API, static)</li>
        <li><strong>@b9g/staticfiles</strong> - Django-style static file handling</li>
        <li><strong>@b9g/match-pattern</strong> - Enhanced URLPattern matching</li>
      </ul>
      
      <div class="cache-info">
        <strong>Cache Statistics:</strong><br>
        Pages Cache: ${context.caches ? "Available" : "Not Available"}<br>
        Static Files: Served from ${process.env.NODE_ENV === "production" ? "optimized build" : "source files"}
      </div>
      
      <p><a href="/">← Back to Home</a></p>
    </div>
  `,
			),
			{
				headers: {
					"Content-Type": "text/html",
					"Cache-Control": "public, max-age=3600", // 1 hour
				},
			},
		);
	});

/**
 * ServiceWorker install event - setup and initialization
 */
self.addEventListener("install", (event) => {
	console.info("[SW] Installing Shovel blog app...");

	event.waitUntil(
		(async () => {
			console.info("[SW] Shovel blog app installed successfully!");
		})(),
	);
});

/**
 * ServiceWorker activate event - ready to handle requests
 */
self.addEventListener("activate", (event) => {
	console.info("[SW] Activating Shovel blog app...");

	event.waitUntil(
		(async () => {
			console.info("[SW] Shovel blog app activated and ready!");
		})(),
	);
});

/**
 * ServiceWorker fetch event - handle HTTP requests
 */
const workerId = Math.random().toString(36).substring(2, 8);
console.log(`[SW-${workerId}] Registering fetch event listener`);
self.addEventListener("fetch", (event) => {
	console.log(`[SW-${workerId}] Fetch event for:`, event.request.url);
	try {
		const responsePromise = router.handler(event.request);
		console.log(`[SW-${workerId}] Router handler returned:`, responsePromise);
	console.log(`[SW-${workerId}] About to call event.respondWith`);
		
		// Add timeout to detect hanging promises
		const timeoutPromise = new Promise((_, reject) => {
			setTimeout(() => reject(new Error("Router response timeout")), 5000);
		});
		
		event.respondWith(Promise.race([responsePromise, timeoutPromise]).catch(error => {
			console.error(`[SW-${workerId}] Router handler error:`, error);
			return new Response("Router error: " + error.message, { status: 500 });
		}));
	} catch (error) {
		console.error(`[SW-${workerId}] Synchronous error in fetch handler:`, error);
		event.respondWith(new Response("Sync error: " + error.message, { status: 500 }));
	}
});

/**
 * Static event - provide routes for static site generation
 */
self.addEventListener("static", (event) => {
	console.info("[SW] Collecting static routes for blog app...");

	event.waitUntil(
		(async () => {
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
		})(),
	);
});

// Helper function to render HTML pages
function renderPage(title, content) {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - Shovel Blog</title>
  <link rel="stylesheet" href="${styles}">
  <link rel="icon" href="${logo}">
</head>
<body>
  <header>
    <img src="${logo}" alt="Shovel" width="48" height="48">
    <h1>Shovel Blog</h1>
    <p class="subtitle">Cache-First Metaframework Demo</p>
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
    <p>Built with ❤️ using <strong>Shovel</strong> - A cache-first metaframework</p>
    <p><small>Static files: ${styles} | ${logo}</small></p>
  </footer>
</body>
</html>`;
}


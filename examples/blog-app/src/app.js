/**
 * Shovel Blog App - ServiceWorker-style entrypoint
 *
 * This demonstrates the new ServiceWorker-based architecture where the
 * entrypoint uses standard ServiceWorker APIs (install, activate, fetch)
 * but runs universally across all platforms.
 */

import {Router} from "@b9g/router";
import {createAssetsMiddleware} from "@b9g/assets";

// Cache control constants
const CACHE_HEADERS = {
	ASSETS: "public, max-age=31536000, immutable", // 1 year for assets
	PAGES: "public, max-age=300", // 5 minutes for pages
	POSTS: "public, max-age=600", // 10 minutes for posts  
	API: "public, max-age=180", // 3 minutes for API
	ABOUT: "public, max-age=3600", // 1 hour for about page
};

// Timeout constants
const TIMEOUTS = {
	ROUTER_RESPONSE: 5000, // 5 seconds for router timeout
};

// Import static assets using import attributes with new /assets/ path
import styles from "./assets/styles.css" with {url: "/assets/"};
import logo from "./assets/logo.svg" with {url: "/assets/"};

// Create router - self.caches and self.dirs are provided directly by platform
const router = new Router();

// Platform provides self.caches and self.dirs directly - no event needed

// Assets middleware - serves from self.dirs.open("assets")
router.use(
	createAssetsMiddleware({
		directory: "assets",
		basePath: "/assets",
		manifestPath: "manifest.json",
		dev: process.env?.NODE_ENV !== "production",
		cacheControl:
			process.env?.NODE_ENV === "production"
				? CACHE_HEADERS.ASSETS
				: "no-cache",
	}),
);

// Global page cache middleware
router.use(pageCache);

// Cache middleware for pages using new generator API
async function* pageCache(request, context) {
	if (request.method !== "GET" || !self.caches) {
		// No caching - just passthrough
		const response = yield request;
		return response;
	}

	// Get the pages cache from platform
	const cache = await self.caches.open("pages");
	const cached = await cache.match(request);
	if (cached) {
		// Cache hit - return early with cached response
		const response = cached.clone();
		response.headers.set("X-Cache", "HIT");
		return response;
	}

	// Cache miss - continue to handler
	const response = yield request;

	// Cache the response for next time
	if (response.ok) {
		await cache.put(request, response.clone());
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

// Routes
router
	.route({
		pattern: "/",
	})
	.get(async (request, context) => {
		return new Response(
			renderPage(
				"Home",
				`
    <div class="cache-info">
      <strong>Cache Status:</strong> ${self.caches ? "Enabled" : "Disabled"} | 
      <strong>Cache Type:</strong> ${self.caches ? "Platform-configured" : "N/A"}
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
					"Cache-Control": CACHE_HEADERS.PAGES,
				},
			},
		);
	});

router
	.route({
		pattern: "/posts/:id",
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
      <strong>Cache Status:</strong> ${self.caches ? "Enabled" : "Disabled"} | 
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
					"Cache-Control": CACHE_HEADERS.POSTS,
				},
			},
		);
	});

// API route - no automatic caching, handled by manual logic if needed
router
	.route({
		pattern: "/api/posts",
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
				cached: !!self.caches,
				timestamp: new Date().toISOString(),
			},
			{
				headers: {
					"Cache-Control": CACHE_HEADERS.API,
				},
			},
		);
	});

// About page
router
	.route({
		pattern: "/about",
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
        Platform Caches: ${self.caches ? "Available" : "Not Available"}<br>
        Static Files: Served from ${process.env.NODE_ENV === "production" ? "optimized build" : "source files"}
      </div>
      
      <p><a href="/">← Back to Home</a></p>
    </div>
  `,
			),
			{
				headers: {
					"Content-Type": "text/html",
					"Cache-Control": CACHE_HEADERS.ABOUT,
				},
			},
		);
	});


/**
 * ServiceWorker install event - setup and initialization
 */
self.addEventListener("install", (event) => {
	event.waitUntil((async () => {})());
});

/**
 * ServiceWorker activate event - handle self-generation
 */
self.addEventListener("activate", (event) => {
	event.waitUntil(generateStaticSite());
});

async function generateStaticSite() {
	console.info("[Blog App] Starting static site generation...");
	
	try {
		// Get directories
		const staticDir = await self.dirs.open("static");
		const assetsDir = await self.dirs.open("assets");
		
		// First, copy assets to static/assets/ for self-contained deployment
		console.info("[Blog App] Copying assets...");
		await copyAssetsToStatic(assetsDir, staticDir);
		
		// Define routes to pre-render
		const staticRoutes = [
			"/",
			"/about",
			"/api/posts",
			...posts.map((post) => `/posts/${post.id}`)
		];
		
		console.info(`[Blog App] Pre-rendering ${staticRoutes.length} routes...`);
		
		for (const route of staticRoutes) {
			try {
				// Generate request for this route
				const request = new Request(`http://localhost:3000${route}`);
				
				// Use our own router to generate the response
				const response = await router.handler(request);
				
				if (response.ok) {
					const content = await response.text();
					
					// Determine filename
					let fileName;
					if (route === "/") {
						fileName = "index.html";
					} else if (route.startsWith("/api/")) {
						fileName = `${route.slice(5)}.json`; // /api/posts -> posts.json
					} else {
						fileName = `${route.slice(1).replace(/\//g, "-")}.html`; // /posts/1 -> posts-1.html
					}
					
					// Write to static directory
					const fileHandle = await staticDir.getFileHandle(fileName, {create: true});
					const writable = await fileHandle.createWritable();
					await writable.write(content);
					await writable.close();
					
					console.info(`[Blog App] ✅ Generated ${route} -> ${fileName}`);
				} else {
					console.warn(`[Blog App] ⚠️  ${route} returned ${response.status}`);
				}
			} catch (error) {
				console.error(`[Blog App] ❌ Failed to generate ${route}:`, error.message);
			}
		}
		
		console.info("[Blog App] ✅ Static site generation complete!");
	} catch (error) {
		console.error("[Blog App] ❌ Static site generation failed:", error.message);
	}
}

/**
 * Copy assets from dist/assets/ to dist/static/assets/ for self-contained deployment
 */
async function copyAssetsToStatic(assetsDir, staticDir) {
	try {
		// Create assets subdirectory in static
		const staticAssetsDir = await staticDir.getDirectoryHandle("assets", {create: true});
		
		// Copy all files from assets to static/assets
		for await (const [name, handle] of assetsDir.entries()) {
			if (handle.kind === "file") {
				// Read from assets
				const file = await handle.getFile();
				const content = await file.arrayBuffer();
				
				// Write to static/assets
				const targetHandle = await staticAssetsDir.getFileHandle(name, {create: true});
				const writable = await targetHandle.createWritable();
				await writable.write(content);
				await writable.close();
				
				console.info(`[Blog App] Copied asset: ${name}`);
			}
		}
		
		console.info("[Blog App] ✅ Assets copied to static/assets/");
	} catch (error) {
		console.error("[Blog App] ❌ Failed to copy assets:", error.message);
	}
}

/**
 * ServiceWorker fetch event - handle HTTP requests
 */
self.addEventListener("fetch", (event) => {
	try {
		const responsePromise = router.handler(event.request);

		// Add timeout to detect hanging promises
		const timeoutPromise = new Promise((_, reject) => {
			setTimeout(() => reject(new Error("Router response timeout")), TIMEOUTS.ROUTER_RESPONSE);
		});

		event.respondWith(
			Promise.race([responsePromise, timeoutPromise]).catch((error) => {
				return new Response("Router error: " + error.message, {status: 500});
			}),
		);
	} catch (error) {
		event.respondWith(
			new Response("Sync error: " + error.message, {status: 500}),
		);
	}
});

/**
 * Static event - provide routes for static site generation
 */
self.addEventListener("static", (event) => {
	event.waitUntil(
		(async () => {
			// Return all routes that should be pre-rendered
			const staticRoutes = [
				"/",
				"/about",
				"/api/posts",
				...posts.map((post) => `/posts/${post.id}`),
			];

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

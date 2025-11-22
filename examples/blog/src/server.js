/**
 * Shovel Blog App - ServiceWorker-style entrypoint
 *
 * This demonstrates the new ServiceWorker-based architecture where the
 * entrypoint uses standard ServiceWorker APIs (install, activate, fetch)
 * but runs universally across all platforms.
 */

import {Router} from "@b9g/router";

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

// Import static assets - served from root
import styles from "./assets/styles.css" with {assetBase: "/"};
import logo from "./assets/logo.svg" with {assetBase: "/"};
import favicon from "./assets/favicon.ico" with {assetBase: "/"};

// Create router - self.caches and self.buckets are provided directly by platform
const router = new Router();

// Platform provides self.caches and self.buckets directly - no event needed

// Global page cache middleware
router.use(pageCache);

// Cache middleware for pages using new generator API
async function* pageCache(request, _context) {
	console.info(
		"[PageCache] Processing:",
		request.url,
		"Method:",
		request.method,
	);

	if (request.method !== "GET" || !self.caches) {
		// No caching - just passthrough
		console.info("[PageCache] No caching, yielding");
		const response = yield request;
		console.info("[PageCache] Got response from yield");
		return response;
	}

	console.info("[PageCache] Opening cache...");
	// Get the pages cache from platform with version for cache invalidation
	const cacheVersion = "v2"; // Increment when asset paths change
	const cache = await self.caches.open(`pages-${cacheVersion}`);
	console.info("[PageCache] Cache opened");
	let cached;
	try {
		// Create a proper Request object from the URL (router passes mutable wrapper)
		console.info("[PageCache] Creating Request from URL:", request.url);
		const cacheRequest = new Request(request.url, {
			method: request.method,
			headers: request.headers,
		});
		console.info("[PageCache] Checking cache.match...");
		cached = await cache.match(cacheRequest);
		console.info("[PageCache] cache.match completed, cached:", !!cached);
	} catch (error) {
		// Fall through to yield request if cache fails
		console.info("[PageCache] cache.match error:", error.message);
		cached = null;
	}

	if (cached) {
		// Cache hit - return early with cached response (clone to modify headers)
		console.info("[PageCache] Cache HIT");
		const clonedResponse = cached.clone();
		const newHeaders = new Headers(clonedResponse.headers);
		newHeaders.set("X-Cache", "HIT");

		return new Response(clonedResponse.body, {
			status: clonedResponse.status,
			statusText: clonedResponse.statusText,
			headers: newHeaders,
		});
	}

	// Cache miss - continue to handler
	console.info("[PageCache] Cache MISS, yielding to handler");
	const response = yield request;
	console.info("[PageCache] Got response from handler");

	// Cache the response for next time
	if (response.ok) {
		// Use a fresh request clone for cache.put to avoid mutations
		const requestForCache = new Request(request.url, {
			method: request.method,
			headers: request.headers,
		});
		await cache.put(requestForCache, response.clone());
	}

	// Clone response to modify headers (Cloudflare Workers has immutable headers)
	const clonedResponse = response.clone();
	const newHeaders = new Headers(clonedResponse.headers);
	newHeaders.set("X-Cache", "MISS");

	return new Response(clonedResponse.body, {
		status: clonedResponse.status,
		statusText: clonedResponse.statusText,
		headers: newHeaders,
	});
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
	.get(async (_request, _context) => {
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
	.get(async (_request, _context) => {
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
	.get(async (_request, _context) => {
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
        Static Files: Served from ${import.meta.env.PROD ? "optimized build" : "source files"}
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
	console.info("[Blog App] process.cwd():", process.cwd());
	console.info("[Blog App] import.meta.url:", import.meta.url);

	try {
		// Get static bucket - the only public bucket (maps to web root)
		console.info("[Blog App] Opening static bucket...");
		const staticBucket = await self.buckets.open("static");
		console.info(
			"[Blog App] static bucket opened:",
			staticBucket.constructor.name,
		);

		// First, copy assets from build output (dist/assets/) to static/assets/
		console.info("[Blog App] Copying assets...");
		await copyAssetsToStatic(staticBucket);

		// Define routes to pre-render
		const staticRoutes = [
			"/",
			"/about",
			"/api/posts",
			...posts.map((post) => `/posts/${post.id}`),
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
					const fileHandle = await staticBucket.getFileHandle(fileName, {
						create: true,
					});
					const writable = await fileHandle.createWritable();
					await writable.write(content);
					await writable.close();

					console.info(`[Blog App] ✅ Generated ${route} -> ${fileName}`);
				} else {
					console.warn(`[Blog App] ⚠️  ${route} returned ${response.status}`);
				}
			} catch (error) {
				console.error(
					`[Blog App] ❌ Failed to generate ${route}:`,
					error.message,
				);
			}
		}

		console.info("[Blog App] ✅ Static site generation complete!");
	} catch (error) {
		console.error(
			"[Blog App] ❌ Static site generation failed:",
			error.message,
		);
	}
}

/**
 * Copy assets from build output (dist/assets/) to static bucket (dist/static/assets/)
 */
async function copyAssetsToStatic(staticBucket) {
	try {
		// Read assets from build output directory using Node.js fs
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const assetsDir = path.default.join(process.cwd(), "dist", "assets");

		// Create assets subdirectory in static bucket
		const staticAssetsDir = await staticBucket.getDirectoryHandle("assets", {
			create: true,
		});

		// Read all files from dist/assets/
		const files = await fs.readdir(assetsDir);

		for (const name of files) {
			const filePath = path.default.join(assetsDir, name);
			const stats = await fs.stat(filePath);

			if (stats.isFile()) {
				// Read from filesystem
				const content = await fs.readFile(filePath);

				// Write to static/assets in bucket
				const targetHandle = await staticAssetsDir.getFileHandle(name, {
					create: true,
				});
				const writable = await targetHandle.createWritable();
				await writable.write(new Uint8Array(content));
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
			setTimeout(
				() => reject(new Error("Router response timeout")),
				TIMEOUTS.ROUTER_RESPONSE,
			);
		});

		event.respondWith(
			Promise.race([responsePromise, timeoutPromise]).catch((error) => {
				// In development, show full error details
				const isDev = process.env?.NODE_ENV !== "production";
				const errorDetails = isDev
					? `Router error: ${error.message}\n\nStack trace:\n${error.stack}`
					: `Router error: ${error.message}`;

				console.error("Router error:", error);
				return new Response(errorDetails, {
					status: 500,
					headers: {"Content-Type": "text/plain"},
				});
			}),
		);
	} catch (error) {
		// In development, show full error details
		const isDev = process.env?.NODE_ENV !== "production";
		const errorDetails = isDev
			? `Sync error: ${error.message}\n\nStack trace:\n${error.stack}`
			: `Sync error: ${error.message}`;

		console.error("Sync error:", error);
		event.respondWith(
			new Response(errorDetails, {
				status: 500,
				headers: {"Content-Type": "text/plain"},
			}),
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
  <link rel="icon" href="${favicon}" type="image/x-icon">
  <link rel="stylesheet" href="${styles}">
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

/**
 * Shovel Admin Dashboard
 *
 * Demonstrates cache-first architecture with SQLite backend:
 * - Blog post management (CRUD)
 * - Documentation management
 * - Cache invalidation on data changes
 * - Bun runtime with better-sqlite3
 */

import {Router} from "@b9g/router";
import {createAssetsMiddleware} from "@b9g/assets";
import {PostsDB, DocsDB} from "./db/database.js";

// Cache control constants
const CACHE_HEADERS = {
	ASSETS: "public, max-age=31536000, immutable", // 1 year for assets
	PAGES: "public, max-age=300", // 5 minutes for admin pages
	API: "public, max-age=60", // 1 minute for API responses
};

// Create router with caching
const router = new Router();

// Assets middleware
router.use(
	createAssetsMiddleware({
		directory: "assets",
		basePath: "/assets",
		manifestPath: "manifest.json",
		dev: import.meta.env.DEV,
		cacheControl: import.meta.env.PROD ? CACHE_HEADERS.ASSETS : "no-cache",
	}),
);

// Cache middleware with versioning for cache-busting
const cacheVersion = "v1"; // Increment when data schema changes
router.use(cacheMiddleware);

async function* cacheMiddleware(request, _context) {
	console.info("[Cache] Processing:", request.url, "Method:", request.method);

	// Only cache GET requests
	if (request.method !== "GET" || !self.caches) {
		const response = yield request;
		return response;
	}

	// Get versioned cache
	const cache = await self.caches.open(`admin-${cacheVersion}`);

	// Try cache first
	let cached;
	try {
		cached = await cache.match(request.clone());
	} catch (error) {
		console.warn("[cache] Cache lookup failed:", error);
		cached = null;
	}

	if (cached) {
		console.info("[Cache] HIT:", request.url);
		// Add cache hit header
		const response = cached.clone();
		response.headers.set("X-Cache", "HIT");
		return response;
	}

	console.info("[Cache] MISS:", request.url);

	// Get fresh response
	const response = yield request;

	// Cache successful responses
	if (response.ok && response.status < 400) {
		try {
			await cache.put(request.clone(), response.clone());
			console.info("[Cache] Stored:", request.url);
		} catch (error) {
			console.warn("[cache] Storage failed:", error);
		}
	}

	// Add cache miss header
	const clonedResponse = response.clone();
	clonedResponse.headers.set("X-Cache", "MISS");
	return clonedResponse;
}

// ===== ADMIN UI ROUTES =====

// Dashboard home
router.route("/").get(async (_request, _context) => {
	const publishedPosts = await PostsDB.findByStatus("published");
	const draftPosts = await PostsDB.findByStatus("draft");
	const allDocs = await DocsDB.findAll();

	return new Response(
		renderPage(
			"Dashboard",
			`
        <div class="dashboard">
            <div class="stats-grid">
                <div class="stat-card">
                    <h3>Published Posts</h3>
                    <div class="stat-number">${publishedPosts.length}</div>
                </div>
                <div class="stat-card">
                    <h3>Draft Posts</h3>
                    <div class="stat-number">${draftPosts.length}</div>
                </div>
                <div class="stat-card">
                    <h3>Documentation</h3>
                    <div class="stat-number">${allDocs.length}</div>
                </div>
                <div class="stat-card">
                    <h3>Cache Status</h3>
                    <div class="stat-text">v${cacheVersion}</div>
                </div>
            </div>
            
            <div class="recent-content">
                <div class="content-section">
                    <h2>Recent Posts</h2>
                    <div class="content-list">
                        ${publishedPosts
													.slice(0, 5)
													.map(
														(post) => `
                            <div class="content-item">
                                <a href="/posts/${post.slug}">${post.title}</a>
                                <span class="content-meta">${new Date(post.created_at).toLocaleDateString()}</span>
                            </div>
                        `,
													)
													.join("")}
                        <a href="/posts" class="view-all">View All Posts →</a>
                    </div>
                </div>
                
                <div class="content-section">
                    <h2>Documentation</h2>
                    <div class="content-list">
                        ${allDocs
													.slice(0, 5)
													.map(
														(doc) => `
                            <div class="content-item">
                                <a href="/docs/${doc.slug}">${doc.title}</a>
                                <span class="content-meta">${doc.category}</span>
                            </div>
                        `,
													)
													.join("")}
                        <a href="/docs" class="view-all">View All Docs →</a>
                    </div>
                </div>
            </div>
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

// Posts list
router.route("/posts").get(async (_request, _context) => {
	const allPosts = await PostsDB.findAll();

	return new Response(
		renderPage(
			"Blog Posts",
			`
        <div class="content-header">
            <h1>Blog Posts</h1>
            <a href="/posts/new" class="btn btn-primary">New Post</a>
        </div>
        
        <div class="posts-table">
            <table>
                <thead>
                    <tr>
                        <th>Title</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${allPosts
											.map(
												(post) => `
                        <tr>
                            <td><a href="/posts/${post.slug}">${post.title}</a></td>
                            <td><span class="status status-${post.status}">${post.status}</span></td>
                            <td>${new Date(post.created_at).toLocaleDateString()}</td>
                            <td>
                                <a href="/posts/${post.slug}/edit" class="btn btn-sm">Edit</a>
                                <button onclick="deletePost('${post.slug}')" class="btn btn-sm btn-danger">Delete</button>
                            </td>
                        </tr>
                    `,
											)
											.join("")}
                </tbody>
            </table>
        </div>
        
        <script>
        async function deletePost(slug) {
            if (confirm('Are you sure you want to delete this post?')) {
                const response = await fetch(\`/api/posts/\${slug}\`, { method: 'DELETE' });
                if (response.ok) {
                    location.reload();
                } else {
                    alert('Failed to delete post');
                }
            }
        }
        </script>
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

// Docs list
router.route("/docs").get(async (_request, _context) => {
	const allDocs = await DocsDB.findAll();
	const categories = [...new Set(allDocs.map((doc) => doc.category))];

	return new Response(
		renderPage(
			"Documentation",
			`
        <div class="content-header">
            <h1>Documentation</h1>
            <a href="/docs/new" class="btn btn-primary">New Doc</a>
        </div>
        
        <div class="docs-by-category">
            ${categories
							.map(
								(category) => `
                <div class="category-section">
                    <h2>${category}</h2>
                    <div class="docs-grid">
                        ${allDocs
													.filter((doc) => doc.category === category)
													.map(
														(doc) => `
                            <div class="doc-card">
                                <h3><a href="/docs/${doc.slug}">${doc.title}</a></h3>
                                <div class="doc-meta">
                                    <span class="status status-${doc.status}">${doc.status}</span>
                                    <span class="version">v${doc.version}</span>
                                </div>
                                <div class="doc-actions">
                                    <a href="/docs/${doc.slug}/edit" class="btn btn-sm">Edit</a>
                                    <button onclick="deleteDoc('${doc.slug}')" class="btn btn-sm btn-danger">Delete</button>
                                </div>
                            </div>
                        `,
													)
													.join("")}
                    </div>
                </div>
            `,
							)
							.join("")}
        </div>
        
        <script>
        async function deleteDoc(slug) {
            if (confirm('Are you sure you want to delete this documentation?')) {
                const response = await fetch(\`/api/docs/\${slug}\`, { method: 'DELETE' });
                if (response.ok) {
                    location.reload();
                } else {
                    alert('Failed to delete doc');
                }
            }
        }
        </script>
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

// ===== API ROUTES =====

// Posts API
router.route("/api/posts").get(async (_request, _context) => {
	const posts = await PostsDB.findAll();
	return Response.json(
		{posts},
		{
			headers: {"Cache-Control": CACHE_HEADERS.API},
		},
	);
});

router.route("/api/posts/:slug").delete(async (request, context) => {
	const {slug} = context.params;
	await PostsDB.delete(slug);

	// Invalidate cache by incrementing version (in real app, you'd update cacheVersion)
	await invalidateCache();

	return Response.json({success: true, deleted: slug});
});

// Docs API
router.route("/api/docs").get(async (_request, _context) => {
	const docs = await DocsDB.findAll();
	return Response.json(
		{docs},
		{
			headers: {"Cache-Control": CACHE_HEADERS.API},
		},
	);
});

router.route("/api/docs/:slug").delete(async (request, context) => {
	const {slug} = context.params;
	await DocsDB.delete(slug);

	// Invalidate cache
	await invalidateCache();

	return Response.json({success: true, deleted: slug});
});

// Cache invalidation helper
async function invalidateCache() {
	// In a real app, you'd increment cacheVersion and redeploy
	// For now, we'll just clear specific cache entries
	if (self.caches) {
		const cache = await self.caches.open(`admin-${cacheVersion}`);
		// Clear main pages that show post/doc lists
		await cache.delete(new Request(new URL("/", "http://localhost").href));
		await cache.delete(new Request(new URL("/posts", "http://localhost").href));
		await cache.delete(new Request(new URL("/docs", "http://localhost").href));
		console.info("[Cache] Invalidated list pages");
	}
}

// ===== ServiceWorker Event Handlers =====

self.addEventListener("install", (event) => {
	event.waitUntil(
		(async () => {
			console.info("[SW] Admin dashboard installed");
		})(),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			console.info("[SW] Admin dashboard activated");
		})(),
	);
});

// For Bun deployment, we need to start an HTTP server
if (typeof Bun !== "undefined") {
	// Running in Bun - start HTTP server
	const port = process.env.PORT || 3000;

	Bun.serve({
		port: port,
		async fetch(request) {
			try {
				return await router.handler(request);
			} catch (error) {
				const isDev = process.env?.NODE_ENV !== "production";
				const errorDetails = isDev
					? `Admin error: ${error.message}\n\nStack: ${error.stack}`
					: `Admin error: ${error.message}`;

				console.error("Admin router error:", error);
				return new Response(errorDetails, {
					status: 500,
					headers: {"Content-Type": "text/plain"},
				});
			}
		},
	});

	console.info(`[Admin] Shovel Admin running on http://localhost:${port}`);
} else {
	// Running as ServiceWorker - use event handlers
	self.addEventListener("fetch", (event) => {
		try {
			const responsePromise = router.handler(event.request);

			event.respondWith(
				responsePromise.catch((error) => {
					const isDev = process.env?.NODE_ENV !== "production";
					const errorDetails = isDev
						? `Admin error: ${error.message}\\n\\nStack: ${error.stack}`
						: `Admin error: ${error.message}`;

					console.error("Admin router error:", error);
					return new Response(errorDetails, {
						status: 500,
						headers: {"Content-Type": "text/plain"},
					});
				}),
			);
		} catch (error) {
			console.error("Admin sync error:", error);
			event.respondWith(
				new Response(`Admin sync error: ${error.message}`, {
					status: 500,
					headers: {"Content-Type": "text/plain"},
				}),
			);
		}
	});
}

// ===== HTML Template Helper =====

function renderPage(title, content) {
	return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - Shovel Admin</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
            line-height: 1.6; 
            color: #333; 
            background: #f8f9fa;
        }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        
        /* Header */
        header { 
            background: white; 
            border-bottom: 1px solid #e9ecef; 
            padding: 1rem 0;
            margin-bottom: 2rem;
        }
        nav { display: flex; gap: 2rem; align-items: center; }
        nav a { text-decoration: none; color: #007bff; font-weight: 500; }
        nav a:hover { color: #0056b3; }
        .logo { font-size: 1.5rem; font-weight: bold; color: #333; }
        
        /* Dashboard */
        .stats-grid { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); 
            gap: 1rem; 
            margin-bottom: 2rem; 
        }
        .stat-card { 
            background: white; 
            padding: 1.5rem; 
            border-radius: 8px; 
            border: 1px solid #e9ecef;
            text-align: center;
        }
        .stat-number { font-size: 2rem; font-weight: bold; color: #007bff; }
        .stat-text { font-size: 1.2rem; color: #28a745; font-weight: 500; }
        
        /* Content sections */
        .recent-content { 
            display: grid; 
            grid-template-columns: 1fr 1fr; 
            gap: 2rem; 
        }
        .content-section { 
            background: white; 
            padding: 1.5rem; 
            border-radius: 8px; 
            border: 1px solid #e9ecef; 
        }
        .content-item { 
            display: flex; 
            justify-content: space-between; 
            padding: 0.5rem 0; 
            border-bottom: 1px solid #f8f9fa; 
        }
        .content-meta { color: #6c757d; font-size: 0.9rem; }
        .view-all { color: #007bff; text-decoration: none; margin-top: 1rem; display: inline-block; }
        
        /* Buttons */
        .btn { 
            padding: 0.5rem 1rem; 
            border: none; 
            border-radius: 4px; 
            text-decoration: none; 
            display: inline-block; 
            cursor: pointer;
            font-size: 0.9rem;
        }
        .btn-primary { background: #007bff; color: white; }
        .btn-danger { background: #dc3545; color: white; }
        .btn-sm { padding: 0.25rem 0.5rem; font-size: 0.8rem; }
        
        /* Tables */
        table { width: 100%; border-collapse: collapse; background: white; }
        th, td { padding: 1rem; text-align: left; border-bottom: 1px solid #e9ecef; }
        th { background: #f8f9fa; font-weight: 600; }
        
        /* Status badges */
        .status { 
            padding: 0.25rem 0.5rem; 
            border-radius: 4px; 
            font-size: 0.8rem; 
            font-weight: 500;
        }
        .status-published { background: #d4edda; color: #155724; }
        .status-draft { background: #fff3cd; color: #856404; }
        .status-archived { background: #f8d7da; color: #721c24; }
        
        /* Docs grid */
        .docs-grid { 
            display: grid; 
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); 
            gap: 1rem; 
        }
        .doc-card { 
            background: white; 
            padding: 1rem; 
            border-radius: 8px; 
            border: 1px solid #e9ecef; 
        }
        .doc-meta { display: flex; gap: 1rem; margin: 0.5rem 0; }
        .doc-actions { margin-top: 1rem; }
        .version { 
            background: #e9ecef; 
            color: #495057; 
            padding: 0.25rem 0.5rem; 
            border-radius: 4px; 
            font-size: 0.8rem; 
        }
        
        /* Content header */
        .content-header { 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
            margin-bottom: 2rem; 
        }
    </style>
</head>
<body>
    <header>
        <div class="container">
            <nav>
                <div class="logo">🥄 Shovel Admin</div>
                <a href="/">Dashboard</a>
                <a href="/posts">Posts</a>
                <a href="/docs">Docs</a>
            </nav>
        </div>
    </header>
    
    <div class="container">
        ${content}
    </div>
</body>
</html>`;
}

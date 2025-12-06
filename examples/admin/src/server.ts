/**
 * Shovel Admin - Bun Example with Google OAuth and Cache
 *
 * Demonstrates:
 * - @b9g/platform-bun - Bun platform
 * - @b9g/auth - Google OAuth with PKCE
 * - @b9g/cache - In-memory caching via self.caches
 * - @b9g/router - Request routing
 */

import {Router} from "@b9g/router";
import {OAuth2Client} from "@b9g/auth/oauth2";
import {createProviderConfig, fetchUserInfo} from "@b9g/auth/providers";

// ============================================================================
// Configuration
// ============================================================================

const config = {
	google: {
		clientID: import.meta.env.GOOGLE_CLIENT_ID ?? "",
		clientSecret: import.meta.env.GOOGLE_CLIENT_SECRET ?? "",
		redirectURI:
			import.meta.env.GOOGLE_REDIRECT_URI ??
			"http://localhost:3000/auth/callback",
	},
	session: {
		cookieName: "session_id",
		maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
	},
};

// ============================================================================
// In-Memory Data Store
// ============================================================================

interface User {
	id: string;
	email: string;
	name: string;
	picture?: string;
}

interface Session {
	userId: string;
	accessToken: string;
	refreshToken?: string;
	expiresAt: number;
}

interface Item {
	id: string;
	title: string;
	content: string;
	createdBy: string;
	createdAt: string;
}

// Simple in-memory stores
const users = new Map<string, User>();
const sessions = new Map<string, Session>();
const items = new Map<string, Item>();

// Seed some demo items
items.set("1", {
	id: "1",
	title: "Welcome to Admin",
	content: "This is a demo item stored in memory.",
	createdBy: "system",
	createdAt: new Date().toISOString(),
});

// ============================================================================
// OAuth2 Client
// ============================================================================

const oauth = new OAuth2Client(
	createProviderConfig("google", {
		clientID: config.google.clientID,
		clientSecret: config.google.clientSecret,
		redirectURI: config.google.redirectURI,
	}),
);

// ============================================================================
// Cache (in-memory via platform's self.caches)
// ============================================================================

let cache: Cache | null = null;

async function getCache(): Promise<Cache | null> {
	if (cache) return cache;

	try {
		cache = await self.caches.open("admin");
		console.info("[Admin] Cache initialized");
		return cache;
	} catch (error) {
		console.warn("[Admin] Cache unavailable:", error);
		return null;
	}
}

// ============================================================================
// Session Helpers
// ============================================================================

function generateSessionId(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function getSession(request: Request): Promise<Session | null> {
	const cookieHeader = request.headers.get("cookie");
	if (!cookieHeader) return null;

	const cookies = Object.fromEntries(
		cookieHeader.split(";").map((c) => {
			const [key, ...value] = c.trim().split("=");
			return [key, value.join("=")];
		}),
	);

	const sessionId = cookies[config.session.cookieName];
	if (!sessionId) return null;

	const session = sessions.get(sessionId);
	if (!session) return null;

	// Check if expired
	if (Date.now() > session.expiresAt) {
		sessions.delete(sessionId);
		return null;
	}

	return session;
}

async function getUser(request: Request): Promise<User | null> {
	const session = await getSession(request);
	if (!session) return null;
	return users.get(session.userId) || null;
}

// ============================================================================
// Router
// ============================================================================

const router = new Router();

// Cache middleware for GET requests
router.use(async function* cacheMiddleware(request) {
	if (request.method !== "GET") {
		return yield request;
	}

	const redisCache = await getCache();
	if (!redisCache) {
		return yield request;
	}

	// Try cache first
	try {
		const cached = await redisCache.match(request);
		if (cached) {
			const response = cached.clone();
			response.headers.set("X-Cache", "HIT");
			return response;
		}
	} catch {
		// Cache miss or error, continue
	}

	const response: Response | undefined = yield request;
	if (!response) return response;

	// Cache successful responses
	if (response.ok) {
		try {
			await redisCache.put(request, response.clone());
		} catch {
			// Cache write failed, continue
		}
	}

	response.headers.set("X-Cache", "MISS");
	return response;
});

// ============================================================================
// Auth Routes
// ============================================================================

// Login - redirect to Google OAuth
router.route("/auth/login").get(async (_request) => {
	if (!config.google.clientID) {
		return new Response(
			renderPage(
				"Configuration Required",
				`<div class="error">
					<h2>Google OAuth Not Configured</h2>
					<p>Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.</p>
					<p><a href="/">← Back to Home</a></p>
				</div>`,
			),
			{status: 500, headers: {"Content-Type": "text/html"}},
		);
	}

	const authURL = await oauth.startAuthorization(self.cookieStore);
	return Response.redirect(authURL, 302);
});

// OAuth callback
router.route("/auth/callback").get(async (request) => {
	try {
		const tokens = await oauth.handleCallback(request, self.cookieStore);
		const userInfo = await fetchUserInfo("google", tokens.accessToken);

		// Create or update user
		const user: User = {
			id: userInfo.id,
			email: userInfo.email,
			name: userInfo.name,
			picture: userInfo.picture,
		};
		users.set(user.id, user);

		// Create session
		const sessionId = generateSessionId();
		const session: Session = {
			userId: user.id,
			accessToken: tokens.accessToken,
			refreshToken: tokens.refreshToken,
			expiresAt: Date.now() + config.session.maxAge,
		};
		sessions.set(sessionId, session);

		// Set session cookie and redirect
		const response = Response.redirect("/", 302);
		await self.cookieStore.set({
			name: config.session.cookieName,
			value: sessionId,
			path: "/",
			sameSite: "lax",
			expires: session.expiresAt,
		});

		return response;
	} catch (error) {
		console.error("[Admin] OAuth callback error:", error);
		return new Response(
			renderPage(
				"Login Failed",
				`<div class="error">
					<h2>Authentication Failed</h2>
					<p>${error instanceof Error ? error.message : "Unknown error"}</p>
					<p><a href="/auth/login">Try Again</a></p>
				</div>`,
			),
			{status: 400, headers: {"Content-Type": "text/html"}},
		);
	}
});

// Logout
router.route("/auth/logout").get(async (request) => {
	const session = await getSession(request);
	if (session) {
		// Find and delete session
		for (const [id, s] of sessions) {
			if (s === session) {
				sessions.delete(id);
				break;
			}
		}
	}

	await self.cookieStore.delete(config.session.cookieName);
	return Response.redirect("/", 302);
});

// ============================================================================
// Protected Routes
// ============================================================================

// Dashboard home
router.route("/").get(async (request) => {
	const user = await getUser(request);

	if (!user) {
		return new Response(
			renderPage(
				"Welcome",
				`<div class="welcome">
					<h2>Welcome to Shovel Admin</h2>
					<p>This example demonstrates:</p>
					<ul>
						<li><strong>@b9g/platform-node</strong> - Node.js runtime</li>
						<li><strong>@b9g/auth</strong> - Google OAuth with PKCE</li>
						<li><strong>@b9g/cache-redis</strong> - Redis caching</li>
						<li><strong>@b9g/router</strong> - Request routing</li>
					</ul>
					<p><a href="/auth/login" class="btn btn-primary">Sign in with Google</a></p>
				</div>`,
			),
			{headers: {"Content-Type": "text/html"}},
		);
	}

	const allItems = Array.from(items.values());

	return new Response(
		renderPage(
			"Dashboard",
			`<div class="dashboard">
				<div class="user-info">
					${user.picture ? `<img src="${user.picture}" alt="${user.name}" class="avatar">` : ""}
					<div>
						<strong>${user.name}</strong>
						<span class="email">${user.email}</span>
					</div>
					<a href="/auth/logout" class="btn btn-sm">Logout</a>
				</div>

				<div class="stats">
					<div class="stat-card">
						<h3>Items</h3>
						<div class="stat-number">${allItems.length}</div>
					</div>
					<div class="stat-card">
						<h3>Cache</h3>
						<div class="stat-text">${cache ? "Active" : "Disabled"}</div>
					</div>
				</div>

				<div class="items">
					<div class="items-header">
						<h2>Items</h2>
						<a href="/items/new" class="btn btn-primary">New Item</a>
					</div>
					<div class="items-list">
						${allItems
							.map(
								(item) => `
							<div class="item-card">
								<h3>${item.title}</h3>
								<p>${item.content}</p>
								<div class="item-meta">
									<span>${new Date(item.createdAt).toLocaleDateString()}</span>
									<a href="/api/items/${item.id}" class="btn btn-sm btn-danger"
									   onclick="return confirm('Delete this item?')"
									   data-method="DELETE">Delete</a>
								</div>
							</div>
						`,
							)
							.join("")}
					</div>
				</div>
			</div>`,
		),
		{
			headers: {
				"Content-Type": "text/html",
				"Cache-Control": "private, no-cache",
			},
		},
	);
});

// New item form
router.route("/items/new").get(async (request) => {
	const user = await getUser(request);
	if (!user) {
		return Response.redirect("/auth/login", 302);
	}

	return new Response(
		renderPage(
			"New Item",
			`<div class="form-container">
				<h2>Create New Item</h2>
				<form method="POST" action="/api/items">
					<div class="form-group">
						<label for="title">Title</label>
						<input type="text" id="title" name="title" required>
					</div>
					<div class="form-group">
						<label for="content">Content</label>
						<textarea id="content" name="content" rows="4" required></textarea>
					</div>
					<div class="form-actions">
						<a href="/" class="btn">Cancel</a>
						<button type="submit" class="btn btn-primary">Create</button>
					</div>
				</form>
			</div>`,
		),
		{headers: {"Content-Type": "text/html"}},
	);
});

// ============================================================================
// API Routes
// ============================================================================

// Create item
router.route("/api/items").post(async (request) => {
	const user = await getUser(request);
	if (!user) {
		return Response.json({error: "Unauthorized"}, {status: 401});
	}

	const formData = await request.formData();
	const title = formData.get("title")?.toString();
	const content = formData.get("content")?.toString();

	if (!title || !content) {
		return Response.json({error: "Missing title or content"}, {status: 400});
	}

	const item: Item = {
		id: crypto.randomUUID(),
		title,
		content,
		createdBy: user.id,
		createdAt: new Date().toISOString(),
	};

	items.set(item.id, item);

	// Redirect back to dashboard
	return Response.redirect("/", 302);
});

// Delete item
router.route("/api/items/:id").delete(async (request, context) => {
	const user = await getUser(request);
	if (!user) {
		return Response.json({error: "Unauthorized"}, {status: 401});
	}

	const id = context.params.id;
	if (!items.has(id)) {
		return Response.json({error: "Not found"}, {status: 404});
	}

	items.delete(id);
	return Response.json({success: true});
});

// List items (JSON API)
router.route("/api/items").get(async (request) => {
	const user = await getUser(request);
	if (!user) {
		return Response.json({error: "Unauthorized"}, {status: 401});
	}

	return Response.json({
		items: Array.from(items.values()),
		count: items.size,
	});
});

// ============================================================================
// 404 Handler
// ============================================================================

router.use(async function* (request) {
	const response: Response | undefined = yield request;
	if (response) return response;

	return new Response(
		renderPage(
			"Not Found",
			`<div class="error">
				<h2>Page Not Found</h2>
				<p><a href="/">← Back to Dashboard</a></p>
			</div>`,
		),
		{status: 404, headers: {"Content-Type": "text/html"}},
	);
});

// ============================================================================
// HTML Template
// ============================================================================

function renderPage(title: string, content: string): string {
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
			background: #f5f5f5;
			padding: 2rem;
		}
		.container { max-width: 800px; margin: 0 auto; }
		h1, h2, h3 { margin-bottom: 1rem; }

		/* Buttons */
		.btn {
			padding: 0.5rem 1rem;
			border: 1px solid #ddd;
			border-radius: 4px;
			text-decoration: none;
			display: inline-block;
			cursor: pointer;
			background: white;
			color: #333;
			font-size: 0.9rem;
		}
		.btn:hover { background: #f5f5f5; }
		.btn-primary { background: #007bff; color: white; border-color: #007bff; }
		.btn-primary:hover { background: #0056b3; }
		.btn-danger { background: #dc3545; color: white; border-color: #dc3545; }
		.btn-sm { padding: 0.25rem 0.5rem; font-size: 0.8rem; }

		/* Welcome */
		.welcome {
			background: white;
			padding: 2rem;
			border-radius: 8px;
			text-align: center;
		}
		.welcome ul {
			text-align: left;
			max-width: 400px;
			margin: 1rem auto;
			list-style: none;
		}
		.welcome li { padding: 0.5rem 0; }

		/* User info */
		.user-info {
			display: flex;
			align-items: center;
			gap: 1rem;
			background: white;
			padding: 1rem;
			border-radius: 8px;
			margin-bottom: 1.5rem;
		}
		.avatar { width: 48px; height: 48px; border-radius: 50%; }
		.email { color: #666; font-size: 0.9rem; display: block; }
		.user-info > div { flex: 1; }

		/* Stats */
		.stats {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
			gap: 1rem;
			margin-bottom: 1.5rem;
		}
		.stat-card {
			background: white;
			padding: 1.5rem;
			border-radius: 8px;
			text-align: center;
		}
		.stat-number { font-size: 2rem; font-weight: bold; color: #007bff; }
		.stat-text { font-size: 1rem; color: #28a745; }

		/* Items */
		.items-header {
			display: flex;
			justify-content: space-between;
			align-items: center;
			margin-bottom: 1rem;
		}
		.items-list { display: grid; gap: 1rem; }
		.item-card {
			background: white;
			padding: 1rem;
			border-radius: 8px;
		}
		.item-meta {
			display: flex;
			justify-content: space-between;
			margin-top: 0.5rem;
			color: #666;
			font-size: 0.9rem;
		}

		/* Forms */
		.form-container {
			background: white;
			padding: 2rem;
			border-radius: 8px;
			max-width: 500px;
			margin: 0 auto;
		}
		.form-group { margin-bottom: 1rem; }
		.form-group label { display: block; margin-bottom: 0.5rem; font-weight: 500; }
		.form-group input, .form-group textarea {
			width: 100%;
			padding: 0.5rem;
			border: 1px solid #ddd;
			border-radius: 4px;
			font-size: 1rem;
		}
		.form-actions { display: flex; gap: 1rem; justify-content: flex-end; }

		/* Error */
		.error {
			background: white;
			padding: 2rem;
			border-radius: 8px;
			text-align: center;
		}
	</style>
</head>
<body>
	<div class="container">
		<header style="margin-bottom: 2rem;">
			<h1><a href="/" style="text-decoration: none; color: inherit;">Shovel Admin</a></h1>
		</header>
		<main>${content}</main>
	</div>
</body>
</html>`;
}

// ============================================================================
// ServiceWorker Event Handlers
// ============================================================================

self.addEventListener("install", () => {
	console.info("[Admin] ServiceWorker installed");
});

self.addEventListener("activate", () => {
	console.info("[Admin] ServiceWorker activated");
	// Initialize cache on activation
	getCache();
});

self.addEventListener("fetch", (event) => {
	event.respondWith(router.handle(event.request));
});

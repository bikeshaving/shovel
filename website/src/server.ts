import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";
import {Router} from "@b9g/router";
import {trailingSlash} from "@b9g/router/middleware";
import {assets as assetsMiddleware} from "@b9g/assets/middleware";

import {collectDocuments} from "./models/document.js";
import {collectBlogPosts} from "./models/blog.js";

// Import views
import HomeView from "./views/home.js";
import GuideView from "./views/guide.js";
import DocView from "./views/doc.js";
import BlogListView from "./views/blog-list.tsx";
import BlogPostView from "./views/blog-post.tsx";
import NotFoundView from "./views/not-found.js";

// Import assets
import clientCSS from "./styles/client.css" with {assetBase: "/static/"};

export const assets = {
	clientCSS,
};

// Create router
const router = new Router();

// Strip trailing slashes
router.use(trailingSlash("strip"));

// Serve static assets
router.use(assetsMiddleware());

// Helper to render a Crank view
async function renderView(
	View: any,
	url: string,
	params: Record<string, string> = {},
): Promise<Response> {
	const html = await renderer.render(jsx`
		<${View}
			url=${url}
			params=${params}
		/>
	`);

	return new Response(html, {
		headers: {"Content-Type": "text/html"},
	});
}

// Routes
router.route("/").get(async (request) => {
	const url = new URL(request.url);
	return renderView(HomeView, url.pathname);
});

router.route("/guides/:slug").get(async (request, context) => {
	const url = new URL(request.url);
	return renderView(GuideView, url.pathname, context.params);
});

router.route("/api").get(async (request) => {
	const url = new URL(request.url);
	return renderView(DocView, url.pathname);
});

router.route("/api/:slug").get(async (request, context) => {
	const url = new URL(request.url);
	return renderView(DocView, url.pathname, context.params);
});

router.route("/blog").get(async (request) => {
	const url = new URL(request.url);
	return renderView(BlogListView, url.pathname);
});

router.route("/blog/:slug").get(async (request, context) => {
	const url = new URL(request.url);
	return renderView(BlogPostView, url.pathname, context.params);
});

// ServiceWorker fetch event
self.addEventListener("fetch", (event) => {
	event.respondWith(handleRequest(event.request));
});

async function handleRequest(request: Request): Promise<Response> {
	const response = await router.handle(request);
	if (response.status === 404) {
		const url = new URL(request.url);
		const html = await renderer.render(jsx`
			<${NotFoundView} url=${url.pathname} />
		`);

		return new Response(html, {
			status: 404,
			headers: {"Content-Type": "text/html"},
		});
	}

	return response;
}

// ServiceWorker install event for static site generation
self.addEventListener("install", (event) => {
	event.waitUntil(generateStaticSite());
});

async function generateStaticSite() {
	if (import.meta.env.MODE !== "production") {
		return;
	}

	const logger = self.loggers.get(["shovel", "website"]);
	logger.info("Starting static site generation...");

	try {
		const staticBucket = await self.directories.open("public");

		// Static routes
		const staticRoutes = ["/", "/api", "/blog"];

		const docsDir = await self.directories.open("docs");

		// Collect guides
		const guidesDir = await docsDir.getDirectoryHandle("guides");
		const guideDocs = await collectDocuments(guidesDir, {pathPrefix: "guides"});
		staticRoutes.push(...guideDocs.map((doc) => doc.url));

		// Collect reference docs (served at /api/)
		const refDir = await docsDir.getDirectoryHandle("reference");
		const refDocs = await collectDocuments(refDir);
		staticRoutes.push(
			...refDocs
				.filter((doc) => doc.url !== "/index")
				.map((doc) => `/api${doc.url}`),
		);

		// Collect blog posts
		const blogDir = await docsDir.getDirectoryHandle("blog");
		const blogPosts = await collectBlogPosts(blogDir);
		staticRoutes.push(...blogPosts.map((post) => post.url));

		logger.info(`Pre-rendering ${staticRoutes.length} routes...`);

		for (const route of staticRoutes) {
			try {
				const response = await fetch(route);

				if (response.ok) {
					const content = await response.text();
					// Generate proper directory structure for static servers
					// /blog/slug -> blog/slug/index.html
					const filePath =
						route === "/" ? "index.html" : `${route.slice(1)}/index.html`;

					// Create nested directories if needed
					const parts = filePath.split("/");
					let currentDir = staticBucket;
					for (let i = 0; i < parts.length - 1; i++) {
						currentDir = await currentDir.getDirectoryHandle(parts[i], {
							create: true,
						});
					}

					const fileName = parts[parts.length - 1];
					const fileHandle = await currentDir.getFileHandle(fileName, {
						create: true,
					});
					const writable = await fileHandle.createWritable();
					await writable.write(content);
					await writable.close();

					logger.info(`Generated ${route} -> ${filePath}`);
				}
			} catch (error: any) {
				logger.error(`Failed to generate ${route}: ${error.message}`);
			}
		}

		// Generate 404.html for static hosting (GitHub Pages, Cloudflare Pages, etc.)
		try {
			const notFoundHtml = await renderer.render(jsx`
				<${NotFoundView} url="/404" />
			`);
			const fileHandle = await staticBucket.getFileHandle("404.html", {
				create: true,
			});
			const writable = await fileHandle.createWritable();
			await writable.write(notFoundHtml);
			await writable.close();
			logger.info("Generated 404.html");
		} catch (error: any) {
			logger.error(`Failed to generate 404.html: ${error.message}`);
		}

		logger.info("Static site generation complete!");
	} catch (error: any) {
		logger.error(`Static site generation failed: ${error.message}`);
	}
}

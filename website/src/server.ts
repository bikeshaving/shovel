import * as Path from "path";

import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";
import {Router} from "@b9g/router";
import {trailingSlash} from "@b9g/router/middleware";
import {assets as assetsMiddleware} from "@b9g/assets/middleware";

import {collectDocuments} from "./models/document.js";
import {collectBlogPosts} from "./models/blog.js";

const __dirname = new URL(".", import.meta.url).pathname;

// Import views
import HomeView from "./views/home.js";
import GuideView from "./views/guide.js";
import DocView from "./views/doc.js";
import BlogListView from "./views/blog-list.tsx";
import BlogPostView from "./views/blog-post.tsx";

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

router.route("/docs/:slug").get(async (request, context) => {
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
	event.respondWith(router.handle(event.request));
});

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
		const staticRoutes = ["/", "/blog"];

		// Collect guides
		const guideDocs = await collectDocuments(
			Path.join(__dirname, "../../docs/guides"),
			Path.join(__dirname, "../../docs"),
		);
		staticRoutes.push(...guideDocs.map((doc) => doc.url));

		// Collect reference docs
		const refDocs = await collectDocuments(
			Path.join(__dirname, "../../docs/reference"),
			Path.join(__dirname, "../../docs"),
		);
		staticRoutes.push(...refDocs.map((doc) => doc.url));

		// Collect blog posts
		const blogPosts = await collectBlogPosts(
			Path.join(__dirname, "../../docs/blog"),
		);
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

		logger.info("Static site generation complete!");
	} catch (error: any) {
		logger.error(`Static site generation failed: ${error.message}`);
	}
}

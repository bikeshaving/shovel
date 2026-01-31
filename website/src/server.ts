import {jsx} from "@b9g/crank/standalone";
import {renderer} from "@b9g/crank/html";
import {Router} from "@b9g/router";
import {trailingSlash} from "@b9g/router/middleware";
import {assets as assetsMiddleware} from "@b9g/assets/middleware";

// Import views
import HomeView from "./views/home.js";
import GuideView from "./views/guide.js";
import DocView from "./views/doc.js";

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

// ServiceWorker fetch event
self.addEventListener("fetch", (event) => {
	event.respondWith(router.handle(event.request));
});

/**
 * Shovel Admin Example
 *
 * Demonstrates @b9g/admin package with:
 * - Auto-generated CRUD for Drizzle schema
 * - Google OAuth authentication
 * - Session storage via self.caches
 */

import {Router} from "@b9g/router";
import {assets} from "@b9g/assets/middleware";
import {createAdmin} from "@b9g/admin";
import {getTableConfig} from "drizzle-orm/sqlite-core";
import * as schema from "./schema.js";

const logger = self.loggers.get("shovel", "server");

// Import USWDS assets - these will be processed at build time
// The @uswds/uswds package exports:
//   - CSS at "./css/*" -> "./dist/css/*"
//   - Main JS at "." -> "./dist/js/uswds.min.js"
// @ts-ignore - import attributes
import uswdsCss from "@uswds/uswds/css/uswds.min.css" with { assetBase: "/uswds/css/", assetName: "uswds.min.css" };
// @ts-ignore - import attributes
import uswdsJs from "@uswds/uswds" with { assetBase: "/uswds/js/", assetName: "uswds.min.js" };

const router = new Router();

// Serve static assets (USWDS CSS, JS, fonts, images)
router.use(assets());

// Mount admin at /admin with USWDS asset URLs
const admin = createAdmin({
	database: "main",
	schema,
	getTableConfig,
	auth: {
		providers: ["google"],
	},
	branding: {
		title: "Shovel Admin",
	},
	// Pass the USWDS asset URLs to the admin
	assets: {
		css: uswdsCss,
		js: uswdsJs,
	},
});

router.mount("/admin", admin);

// Redirect root to admin
router.route("/").get(() => {
	return Response.redirect("/admin", 302);
});

// ServiceWorker event handlers
self.addEventListener("install", () => {
	logger.info("ServiceWorker installed");
});

self.addEventListener("activate", () => {
	logger.info("ServiceWorker activated");
});

self.addEventListener("fetch", (event) => {
	logger.debug("Fetch event", {url: event.request.url});
	try {
		const responsePromise = router.handle(event.request);
		event.respondWith(
			responsePromise
				.then((res) => {
					logger.debug("Response", {status: res.status, url: event.request.url});
					return res;
				})
				.catch((err) => {
					logger.error("Router error", {error: err});
					return new Response("Internal Server Error", {status: 500});
				}),
		);
	} catch (err) {
		logger.error("Sync error", {error: err});
		event.respondWith(new Response("Internal Server Error (sync)", {status: 500}));
	}
});

/**
 * Shovel Admin Example
 *
 * Demonstrates @b9g/admin package with:
 * - Auto-generated CRUD for @b9g/zen schema
 * - Google OAuth authentication (TODO)
 * - Session storage via self.caches (TODO)
 */

import {Router} from "@b9g/router";
import {assets} from "@b9g/assets/middleware";
import {createAdmin} from "@b9g/admin";
import * as schema from "./schema.js";

const logger = self.loggers.get(["shovel", "server"]);

// Import USWDS assets - these will be processed at build time
// The @uswds/uswds package exports:
//   - CSS at "./css/*" -> "./dist/css/*"
//   - Main JS at "." -> "./dist/js/uswds.min.js"
import uswdsCSS from "@uswds/uswds/css/uswds.min.css" with {
	assetBase: "/static/",
};
import uswdsJS from "@uswds/uswds" with {assetBase: "/static/"};

const router = new Router();

// Serve static assets (USWDS CSS, JS, fonts, images)
router.use(assets());

// Mount admin at /admin with USWDS asset URLs
const admin = createAdmin({
	database: "main",
	schema,
	auth: {
		providers: ["google"],
	},
	branding: {
		title: "Shovel Admin",
	},
	// Pass the USWDS asset URLs to the admin
	assets: {
		css: uswdsCSS,
		js: uswdsJS,
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

self.addEventListener("activate", (event) => {
	logger.info("ServiceWorker activated");

	// Open the database and run migrations
	event.waitUntil(
		self.databases.open("main", 1, (e) => {
			e.waitUntil(
				(async () => {
					const db = e.db;
					logger.info("Running migrations", {
						oldVersion: e.oldVersion,
						newVersion: e.newVersion,
					});

					if (e.oldVersion < 1) {
						// Create tables
						await db.ensureTable(schema.users);
						await db.ensureTable(schema.posts);
						await db.ensureTable(schema.tags);
						logger.info("Created tables: users, posts, tags");
					}
				})(),
			);
		}),
	);
});

self.addEventListener("fetch", (ev) => {
	logger.debug("Fetch event", {url: ev.request.url});
	ev.respondWith(router.handle(ev.request));
});

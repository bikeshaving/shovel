/**
 * Shovel Admin Example
 *
 * Demonstrates @b9g/admin package with:
 * - Auto-generated CRUD for Drizzle schema
 * - Google OAuth authentication
 * - Session storage via self.caches
 */

import {Router} from "@b9g/router";
import {createAdmin} from "@b9g/admin";

const router = new Router();

// Mount admin at /admin
const admin = createAdmin({
	database: "main",
	auth: {
		providers: ["google"],
	},
	branding: {
		title: "Shovel Admin",
	},
});

router.mount("/admin", admin);

// Redirect root to admin
router.route("/").get(() => {
	return Response.redirect("/admin", 302);
});

// ServiceWorker event handlers
self.addEventListener("install", () => {
	console.info("[Admin] ServiceWorker installed");
});

self.addEventListener("activate", () => {
	console.info("[Admin] ServiceWorker activated");
});

self.addEventListener("fetch", (event) => {
	event.respondWith(router.handle(event.request));
});

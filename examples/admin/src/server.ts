/**
 * Shovel Admin Example
 *
 * Demonstrates @b9g/admin package with:
 * - Auto-generated CRUD for @b9g/zen schema
 * - HTTP Basic authentication via the required `authorize` option
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

/**
 * Compare two strings without leaking where they differ through timing
 */
async function safeEqual(a: string, b: string): Promise<boolean> {
	const encoder = new TextEncoder();
	const [hashA, hashB] = await Promise.all([
		crypto.subtle.digest("SHA-256", encoder.encode(a)),
		crypto.subtle.digest("SHA-256", encoder.encode(b)),
	]);
	const bytesA = new Uint8Array(hashA);
	const bytesB = new Uint8Array(hashB);
	let diff = 0;
	for (let i = 0; i < bytesA.length; i++) {
		diff |= bytesA[i] ^ bytesB[i];
	}
	return diff === 0;
}

/**
 * Decode the credentials of a Basic Authorization header, or null if malformed
 */
function decodeBasicAuth(header: string | null): string | null {
	if (!header?.startsWith("Basic ")) {
		return null;
	}
	try {
		return atob(header.slice("Basic ".length));
	} catch (err) {
		logger.debug("Malformed Basic credentials", {error: err});
		return null;
	}
}

/**
 * HTTP Basic auth against ADMIN_USERNAME / ADMIN_PASSWORD.
 * Denies everything when ADMIN_PASSWORD is not set.
 */
async function authorize(request: Request): Promise<boolean | Response> {
	const username = import.meta.env.ADMIN_USERNAME || "admin";
	const password = import.meta.env.ADMIN_PASSWORD;
	if (!password) {
		logger.error("ADMIN_PASSWORD is not set; denying admin access");
		return false;
	}

	const credentials = decodeBasicAuth(request.headers.get("Authorization"));
	if (credentials) {
		const separator = credentials.indexOf(":");
		if (
			separator !== -1 &&
			(await safeEqual(credentials.slice(0, separator), username)) &&
			(await safeEqual(credentials.slice(separator + 1), password))
		) {
			return true;
		}
	}

	return new Response("Authentication required", {
		status: 401,
		headers: {
			"WWW-Authenticate": 'Basic realm="Shovel Admin", charset="UTF-8"',
		},
	});
}

const router = new Router();

// Serve static assets (USWDS CSS, JS, fonts, images)
router.use(assets());

// Mount admin at /admin with USWDS asset URLs
const admin = createAdmin({
	database: "main",
	schema,
	authorize,
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
					const db = e.db as {ensureTable(table: unknown): Promise<void>};
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

/**
 * @b9g/admin - Main admin factory
 *
 * Creates a mountable Router with admin routes.
 */

import {Router} from "@b9g/router";
import {trailingSlash} from "@b9g/router/middleware";
import type {AdminConfig} from "./types.js";

/**
 * Create an admin router that can be mounted on any path
 *
 * @example
 * ```typescript
 * import { Router } from '@b9g/router';
 * import { createAdmin } from '@b9g/admin';
 *
 * const admin = createAdmin({
 *   database: 'main',
 *   auth: {
 *     providers: ['google'],
 *   },
 * });
 *
 * const router = new Router();
 * router.mount('/admin', admin);
 * ```
 */
export function createAdmin(config: AdminConfig): Router {
	const router = new Router();

	// Normalize trailing slashes - strip them
	router.use(trailingSlash("strip"));

	// Store config for use in routes
	const title = config.branding?.title ?? "Admin";

	// ============================================================================
	// Static Assets
	// ============================================================================

	router.route("/static/*path").get((_req, ctx) => {
		// TODO: Serve bundled CSS/JS
		const path = ctx.params.path;
		return new Response(`Static file: ${path}`, {
			status: 404,
			headers: {"Content-Type": "text/plain"},
		});
	});

	// ============================================================================
	// Auth Routes (Phase 2)
	// ============================================================================

	router.route("/auth/login").get((_req, ctx) => {
		// Get base path from request URL for relative links
		const url = new URL(_req.url);
		const basePath = url.pathname.replace(/\/auth\/login$/, "");

		const html = `<!DOCTYPE html>
<html>
<head><title>Login - ${title}</title></head>
<body>
  <h1>${title}</h1>
  <p>Login with:</p>
  <ul>
    ${config.auth.providers.map((p) => `<li><a href="${basePath}/auth/${p}">${p}</a></li>`).join("\n    ")}
  </ul>
</body>
</html>`;
		return new Response(html, {
			headers: {"Content-Type": "text/html"},
		});
	});

	router.route("/auth/:provider").get((_req, ctx) => {
		// TODO: Start OAuth2 flow
		const provider = ctx.params.provider;
		return new Response(`TODO: Start ${provider} OAuth2 flow`, {
			status: 501,
		});
	});

	router.route("/auth/callback").get(() => {
		// TODO: Handle OAuth2 callback
		return new Response("TODO: Handle OAuth2 callback", {status: 501});
	});

	router.route("/auth/logout").get(() => {
		// TODO: Clear session
		return new Response("TODO: Logout", {status: 501});
	});

	// ============================================================================
	// Dashboard
	// ============================================================================

	router.route("/").get(() => {
		// TODO: List all registered models
		const html = `<!DOCTYPE html>
<html>
<head><title>${title}</title></head>
<body>
  <h1>${title}</h1>
  <p>Database: ${config.database}</p>
  <p>Models will be listed here after schema introspection.</p>
</body>
</html>`;
		return new Response(html, {
			headers: {"Content-Type": "text/html"},
		});
	});

	// ============================================================================
	// CRUD Routes (Phase 3)
	// ============================================================================

	// List view
	router.route("/:model").get((_req, ctx) => {
		const model = ctx.params.model;
		return new Response(`TODO: List ${model}`, {status: 501});
	});

	// Create form
	router.route("/:model/new").get((_req, ctx) => {
		const model = ctx.params.model;
		return new Response(`TODO: Create form for ${model}`, {status: 501});
	});

	// Handle create
	router.route("/:model/new").post((_req, ctx) => {
		const model = ctx.params.model;
		return new Response(`TODO: Handle create ${model}`, {status: 501});
	});

	// Detail view
	router.route("/:model/:id").get((_req, ctx) => {
		const {model, id} = ctx.params;
		return new Response(`TODO: Detail view for ${model} #${id}`, {status: 501});
	});

	// Edit form
	router.route("/:model/:id/edit").get((_req, ctx) => {
		const {model, id} = ctx.params;
		return new Response(`TODO: Edit form for ${model} #${id}`, {status: 501});
	});

	// Handle edit
	router.route("/:model/:id/edit").post((_req, ctx) => {
		const {model, id} = ctx.params;
		return new Response(`TODO: Handle edit ${model} #${id}`, {status: 501});
	});

	// Delete confirmation
	router.route("/:model/:id/delete").get((_req, ctx) => {
		const {model, id} = ctx.params;
		return new Response(`TODO: Delete confirmation for ${model} #${id}`, {
			status: 501,
		});
	});

	// Handle delete
	router.route("/:model/:id/delete").post((_req, ctx) => {
		const {model, id} = ctx.params;
		return new Response(`TODO: Handle delete ${model} #${id}`, {status: 501});
	});

	return router;
}

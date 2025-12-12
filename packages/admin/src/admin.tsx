/// <reference types="@b9g/platform/globals.d.ts" />
/**
 * @b9g/admin - Main admin factory
 *
 * Creates a mountable Router with admin routes using Crank.js for rendering.
 */

import {Router} from "@b9g/router";
import {trailingSlash} from "@b9g/router/middleware";
import {renderer} from "@b9g/crank/html";
import type {Children} from "@b9g/crank";
import type {Collection} from "@b9g/database";
import type {AdminConfig, TableMetadata, ColumnMetadata} from "./types.js";
import {
	introspectSchema,
	isCollection,
	getDisplayName,
} from "./core/introspection.js";
import {PageLayout} from "./ui/Layout.js";

const logger = self.loggers.get("shovel", "admin");

interface ModelInfo {
	name: string;
	displayName: string;
	metadata: TableMetadata;
	collection: Collection<any>;
}

/**
 * Render a JSX element to an HTML Response
 */
function html(element: Children): Response {
	const content = renderer.render(element);
	return new Response("<!DOCTYPE html>" + content, {
		headers: {"Content-Type": "text/html; charset=utf-8"},
	});
}

import type {AssetsConfig} from "./types.js";

/**
 * Render an error page with details for debugging
 */
function errorPage(
	title: string,
	basePath: string,
	models: ModelInfo[],
	error: unknown,
	assets?: AssetsConfig,
): Response {
	const message = error instanceof Error ? error.message : String(error);
	const stack = error instanceof Error ? error.stack : undefined;

	return html(
		<PageLayout
			title={title}
			pageTitle="Error"
			basePath={basePath}
			models={models}
			assets={assets}
		>
			<h1 class="usa-heading">Error</h1>
			<div class="usa-alert usa-alert--error" role="alert">
				<div class="usa-alert__body">
					<h4 class="usa-alert__heading">Something went wrong</h4>
					<p class="usa-alert__text">{message}</p>
				</div>
			</div>
			{stack && (
				<details class="margin-top-2">
					<summary class="usa-link" style="cursor: pointer;">
						Stack trace
					</summary>
					<pre
						class="margin-top-1 padding-2 bg-ink text-white font-mono-sm"
						style="overflow-x: auto;"
					>
						{stack}
					</pre>
				</details>
			)}
		</PageLayout>,
	);
}

/**
 * Get the base path from a request URL by removing the known route suffix
 */
function getBasePath(url: string, suffix: string): string {
	const urlObj = new URL(url);
	const pattern = new RegExp(suffix.replace(/:[^/]+/g, "[^/]+") + "$");
	return urlObj.pathname.replace(pattern, "").replace(/\/$/, "");
}

/**
 * Create an admin router that can be mounted on any path
 */
export function createAdmin(config: AdminConfig): Router {
	logger.debug("createAdmin called", {database: config.database});
	const router = new Router();

	// Normalize trailing slashes - strip them
	router.use(trailingSlash("strip"));

	// Store config for use in routes
	const title = config.branding?.title ?? "Admin";
	const assets = config.assets;
	logger.debug("Admin config", {title, hasAssets: !!assets});

	// Introspect schema to get table metadata
	logger.debug("Introspecting schema...");
	const tables = introspectSchema(config.schema);

	// Build model info array for navigation
	const models: ModelInfo[] = [];
	for (const [name, metadata] of tables) {
		const collection = Object.values(config.schema).find(
			(c): c is Collection<any> => isCollection(c) && c.name === name,
		);
		if (collection) {
			const modelConfig = config.models?.[name];
			models.push({
				name,
				displayName: modelConfig?.name ?? getDisplayName(name),
				metadata,
				collection,
			});
		}
	}

	// Sort models alphabetically
	models.sort((a, b) => a.displayName.localeCompare(b.displayName));

	// ============================================================================
	// Auth Routes
	// ============================================================================

	router.route("/auth/login").get((req) => {
		const basePath = getBasePath(req.url, "/auth/login");

		return html(
			<PageLayout
				title={title}
				pageTitle="Login"
				basePath={basePath}
				models={models}
				assets={assets}
			>
				<h1 class="usa-heading">Login</h1>
				<div class="admin-card">
					<p class="usa-prose">Choose a provider to sign in:</p>
					<div class="usa-button-group margin-top-2">
						{config.auth.providers.map((p) => (
							<a href={`${basePath}/auth/${p}`} class="usa-button">
								Sign in with {p.charAt(0).toUpperCase() + p.slice(1)}
							</a>
						))}
					</div>
				</div>
			</PageLayout>,
		);
	});

	router.route("/auth/:provider").get((_req, ctx) => {
		const provider = ctx.params.provider;
		return new Response(`TODO: Start ${provider} OAuth2 flow`, {
			status: 501,
		});
	});

	router.route("/auth/callback").get(() => {
		return new Response("TODO: Handle OAuth2 callback", {status: 501});
	});

	router.route("/auth/logout").get(() => {
		return new Response("TODO: Logout", {status: 501});
	});

	// ============================================================================
	// Dashboard
	// ============================================================================

	router.route("/").get((req) => {
		logger.debug("Dashboard route hit", {url: req.url});
		const basePath = getBasePath(req.url, "/");
		logger.debug("Computed basePath", {basePath});

		try {
			const result = html(
				<PageLayout
					title={title}
					pageTitle="Dashboard"
					basePath={basePath}
					models={models}
					assets={assets}
				>
					<h1 class="usa-heading">Dashboard</h1>
					<p class="usa-intro text-base-dark margin-bottom-3">
						Database: {config.database}
					</p>

					<ul class="usa-card-group">
						{models.map((m) => (
							<li class="usa-card tablet:grid-col-4">
								<div class="usa-card__container">
									<div class="usa-card__header">
										<h2 class="usa-card__heading">
											<a href={`${basePath}/${m.name}`} class="usa-link">
												{m.displayName}
											</a>
										</h2>
									</div>
									<div class="usa-card__body">
										<p>{m.metadata.columns.length} columns</p>
									</div>
									<div class="usa-card__footer">
										<a
											href={`${basePath}/${m.name}/new`}
											class="usa-button usa-button--outline"
										>
											Add New
										</a>
									</div>
								</div>
							</li>
						))}
					</ul>

					{models.length === 0 && (
						<div class="admin-empty">
							<p>No models found in schema.</p>
							<p class="margin-top-1 text-base">
								Make sure your schema exports @b9g/database collections.
							</p>
						</div>
					)}
				</PageLayout>,
			);
			logger.debug("Dashboard render successful");
			return result;
		} catch (err) {
			logger.error("Dashboard render error:", {error: err});
			throw err;
		}
	});

	// ============================================================================
	// CRUD Routes - TODO: Implement with @b9g/database
	// ============================================================================

	// List view
	router.route("/:model").get(async (req, ctx) => {
		const modelName = ctx.params.model;
		const model = models.find((m) => m.name === modelName);

		if (!model) {
			return new Response("Model not found", {status: 404});
		}

		const basePath = getBasePath(req.url, `/${modelName}`);

		// TODO: Implement with @b9g/database
		// const db = self.databases.get(config.database);
		// const records = await db.query`SELECT * FROM ${model.name} LIMIT 25`;

		return html(
			<PageLayout
				title={title}
				pageTitle={model.displayName}
				basePath={basePath}
				models={models}
				assets={assets}
			>
				<div class="admin-header">
					<h1 class="usa-heading">{model.displayName}</h1>
					<a href={`${basePath}/${modelName}/new`} class="usa-button">
						Add {model.displayName}
					</a>
				</div>

				<div class="usa-alert usa-alert--info" role="alert">
					<div class="usa-alert__body">
						<p class="usa-alert__text">
							CRUD operations not yet implemented. Migrate to @b9g/database in progress.
						</p>
					</div>
				</div>
			</PageLayout>,
		);
	});

	// Create form
	router.route("/:model/new").get((req, ctx) => {
		const modelName = ctx.params.model;
		const model = models.find((m) => m.name === modelName);

		if (!model) {
			return new Response("Model not found", {status: 404});
		}

		const basePath = getBasePath(req.url, `/${modelName}/new`);

		return html(
			<PageLayout
				title={title}
				pageTitle={`New ${model.displayName}`}
				basePath={basePath}
				models={models}
				assets={assets}
			>
				<h1 class="usa-heading">New {model.displayName}</h1>
				<div class="usa-alert usa-alert--info" role="alert">
					<div class="usa-alert__body">
						<p class="usa-alert__text">
							Create form not yet implemented. Migrate to @b9g/database in progress.
						</p>
					</div>
				</div>
			</PageLayout>,
		);
	});

	// Handle create
	router.route("/:model/new").post(async (req, ctx) => {
		const modelName = ctx.params.model;
		const basePath = getBasePath(req.url, `/${modelName}/new`);
		return Response.redirect(`${basePath}/${modelName}`, 303);
	});

	// Detail view
	router.route("/:model/:id").get(async (req, ctx) => {
		const modelName = ctx.params.model;
		const id = ctx.params.id;
		const model = models.find((m) => m.name === modelName);

		if (!model) {
			return new Response("Model not found", {status: 404});
		}

		const basePath = getBasePath(req.url, `/${modelName}/${id}`);

		return html(
			<PageLayout
				title={title}
				pageTitle={`${model.displayName} #${id}`}
				basePath={basePath}
				models={models}
				assets={assets}
			>
				<h1 class="usa-heading">{model.displayName} #{id}</h1>
				<div class="usa-alert usa-alert--info" role="alert">
					<div class="usa-alert__body">
						<p class="usa-alert__text">
							Detail view not yet implemented. Migrate to @b9g/database in progress.
						</p>
					</div>
				</div>
			</PageLayout>,
		);
	});

	// Edit form
	router.route("/:model/:id/edit").get(async (req, ctx) => {
		const modelName = ctx.params.model;
		const id = ctx.params.id;
		const model = models.find((m) => m.name === modelName);

		if (!model) {
			return new Response("Model not found", {status: 404});
		}

		const basePath = getBasePath(req.url, `/${modelName}/${id}/edit`);

		return html(
			<PageLayout
				title={title}
				pageTitle={`Edit ${model.displayName} #${id}`}
				basePath={basePath}
				models={models}
				assets={assets}
			>
				<h1 class="usa-heading">Edit {model.displayName} #{id}</h1>
				<div class="usa-alert usa-alert--info" role="alert">
					<div class="usa-alert__body">
						<p class="usa-alert__text">
							Edit form not yet implemented. Migrate to @b9g/database in progress.
						</p>
					</div>
				</div>
			</PageLayout>,
		);
	});

	// Handle edit
	router.route("/:model/:id/edit").post(async (req, ctx) => {
		const modelName = ctx.params.model;
		const id = ctx.params.id;
		const basePath = getBasePath(req.url, `/${modelName}/${id}/edit`);
		return Response.redirect(`${basePath}/${modelName}/${id}`, 303);
	});

	// Delete confirmation
	router.route("/:model/:id/delete").get(async (req, ctx) => {
		const modelName = ctx.params.model;
		const id = ctx.params.id;
		const model = models.find((m) => m.name === modelName);

		if (!model) {
			return new Response("Model not found", {status: 404});
		}

		const basePath = getBasePath(req.url, `/${modelName}/${id}/delete`);

		return html(
			<PageLayout
				title={title}
				pageTitle={`Delete ${model.displayName} #${id}`}
				basePath={basePath}
				models={models}
				assets={assets}
			>
				<h1 class="usa-heading">Delete {model.displayName} #{id}</h1>
				<div class="usa-alert usa-alert--info" role="alert">
					<div class="usa-alert__body">
						<p class="usa-alert__text">
							Delete not yet implemented. Migrate to @b9g/database in progress.
						</p>
					</div>
				</div>
			</PageLayout>,
		);
	});

	// Handle delete
	router.route("/:model/:id/delete").post(async (req, ctx) => {
		const modelName = ctx.params.model;
		const basePath = getBasePath(req.url, `/${modelName}`);
		return Response.redirect(`${basePath}/${modelName}`, 303);
	});

	return router;
}

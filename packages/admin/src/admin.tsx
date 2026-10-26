/// <reference types="@b9g/platform/globals.d.ts" />
/**
 * @b9g/admin - AdminRouter implementation
 */

import {Router, type RouteContext} from "@b9g/router";
import {trailingSlash} from "@b9g/router/middleware";
import {renderer} from "@b9g/crank/html";
import type {Children} from "@b9g/crank";
import type {Table, Database} from "@b9g/zen";
import {ValidationError} from "@b9g/zen";
import {
	type AdminTableInfo,
	getAdminSchemaInfo,
	getDisplayName,
} from "./core/introspection.js";
import {PageLayout} from "./ui/Layout.js";
import {ModelForm, parseFormData} from "./ui/Form.js";

const logger = self.loggers.get(["shovel", "admin"]);

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Authorization check run before every admin request.
 *
 * Return `true` to allow the request, a `Response` to send instead (e.g. a
 * redirect to your login page or a 401 challenge), or `false` to deny with
 * 403. Any other result also denies, so the check fails closed.
 */
export type AdminAuthorize = (
	request: Request,
	context: RouteContext,
) => boolean | Response | Promise<boolean | Response>;

/** Per-model display and behavior configuration */
export interface ModelConfig {
	/** Display name for the model (defaults to table name) */
	name?: string;
	/** Columns to show in list view (defaults to all non-blob columns) */
	listFields?: string[];
	/** Fields that can be searched */
	searchFields?: string[];
	/** Fields to hide from forms */
	excludeFields?: string[];
	/** Fields that cannot be edited */
	readOnlyFields?: string[];
	/** Items per page in list view (default: 25) */
	pageSize?: number;
}

/** Admin branding customization */
export interface BrandingConfig {
	/** Admin panel title */
	title?: string;
	/** Logo URL */
	logo?: string;
}

/** USWDS asset URLs for the admin UI */
interface AssetsConfig {
	/** URL to USWDS CSS file */
	css: string;
	/** URL to USWDS main JS file */
	js: string;
}

/** Main admin configuration */
export interface AdminConfig {
	/** Database name from shovel.json to use */
	database: string;
	/** Schema object containing @b9g/zen collection definitions */
	schema: Record<string, unknown>;
	/** Base path for admin routes (default: '/admin') */
	basePath?: string;
	/**
	 * Required authorization check for every admin route.
	 *
	 * Pass "unsafe-allow-all" to disable authorization entirely. This exposes
	 * full read and write access to the database and is only meant for local
	 * development.
	 */
	authorize: AdminAuthorize | "unsafe-allow-all";
	/** Per-model customization keyed by table name */
	models?: Record<string, ModelConfig>;
	/** Branding customization */
	branding?: BrandingConfig;
	/** USWDS asset URLs - if not provided, will use default relative paths */
	assets?: AssetsConfig;
}

// ============================================================================
// Public Types
// ============================================================================

/** Model information exposed by AdminRouter */
export interface AdminModel {
	/** Table name in the database */
	name: string;
	/** Human-readable display name */
	displayName: string;
	/** Admin-specific table info */
	tableInfo: AdminTableInfo;
	/** The @b9g/zen table definition */
	table: Table<any>;
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

/**
 * Render an error page with details for debugging
 */
function errorPage(
	title: string,
	basePath: string,
	models: readonly AdminModel[],
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
 * Get the base path from a request URL by removing as many trailing segments
 * as the route pattern has. Request data never becomes a RegExp here.
 */
function getBasePath(url: string, pattern: string): string {
	let pathname = new URL(url).pathname;
	while (pathname.endsWith("/")) {
		pathname = pathname.slice(0, -1);
	}
	const segments = pathname.split("/");
	const depth = pattern.split("/").filter(Boolean).length;
	return segments.slice(0, segments.length - depth).join("/");
}

/** Methods that cannot change state and are exempt from the CSRF check */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Stateless CSRF check for state-changing requests.
 *
 * Modern browsers send Sec-Fetch-Site on every request, so when it is present
 * it must be "same-origin". Otherwise Origin, then Referer, must match the
 * request's origin. Requests with none of these headers are rejected.
 */
function isSameOriginRequest(request: Request): boolean {
	const fetchSite = request.headers.get("Sec-Fetch-Site");
	if (fetchSite !== null) {
		return fetchSite === "same-origin";
	}

	const expected = new URL(request.url).origin;
	const origin = request.headers.get("Origin");
	if (origin !== null) {
		return origin === expected;
	}

	const referer = request.headers.get("Referer");
	if (referer !== null && URL.canParse(referer)) {
		return new URL(referer).origin === expected;
	}

	return false;
}

/**
 * Get the primary key value from a record
 */
function getPrimaryKeyValue(
	record: Record<string, unknown>,
	tableInfo: AdminTableInfo,
): string {
	if (!tableInfo.primaryKey) {
		throw new Error("Table has no primary key");
	}
	const value = record[tableInfo.primaryKey];
	return String(value);
}

/**
 * Parse ID from URL parameter based on primary key type.
 * Returns null if the ID is invalid (e.g., non-numeric string for numeric PK).
 */
function parseId(
	id: string,
	tableInfo: AdminTableInfo,
): string | number | null {
	if (!tableInfo.primaryKey) {
		throw new Error("Table has no primary key");
	}
	const pkColumn = tableInfo.columns.find(
		(c) => c.name === tableInfo.primaryKey,
	);
	if (pkColumn?.dataType === "number") {
		// Use Number() instead of parseInt() to reject partial matches like "123abc"
		const parsed = Number(id);
		if (!Number.isInteger(parsed)) {
			return null;
		}
		return parsed;
	}
	return id;
}

/**
 * Format a value for display in a table cell
 */
function formatValue(value: unknown): string {
	if (value === null || value === undefined) {
		return "—";
	}
	if (value instanceof Date) {
		return value.toLocaleString();
	}
	if (typeof value === "boolean") {
		return value ? "Yes" : "No";
	}
	if (typeof value === "object") {
		return JSON.stringify(value);
	}
	return String(value);
}

/**
 * Admin router that can be mounted on any path.
 *
 * Extends Router with admin-specific properties and auto-generated CRUD routes.
 * Every request is checked by `config.authorize`, and state-changing requests
 * must also pass a same-origin CSRF check.
 *
 * @example
 * ```typescript
 * const admin = new AdminRouter({
 *   database: "main",
 *   schema,
 *   authorize: async (request) => (await getSession(request))?.isAdmin ?? false,
 * });
 *
 * // Access introspected models
 * console.log(admin.models.map(m => m.name));
 *
 * // Mount on a path
 * router.mount("/admin", admin);
 * ```
 */
export class AdminRouter extends Router {
	/** The admin configuration */
	readonly config: AdminConfig;

	/** Introspected models from the schema */
	readonly models: readonly AdminModel[];

	/** Admin panel title */
	readonly #title: string;

	/** Asset URLs */
	readonly #assets?: AssetsConfig;

	constructor(config: AdminConfig) {
		super();
		const authorize = config.authorize;
		if (typeof authorize !== "function" && authorize !== "unsafe-allow-all") {
			throw new TypeError(
				"AdminRouter requires an `authorize` option: a function " +
					"(request, context) => boolean | Response that allows only " +
					'admins, or "unsafe-allow-all" to disable authorization for ' +
					"local development.",
			);
		}

		this.config = config;

		logger.debug("AdminRouter created", {database: config.database});

		// Security middleware must be registered before anything else so it runs
		// first, including when this router is mounted on another router.
		this.use((req) => {
			if (!SAFE_METHODS.has(req.method.toUpperCase())) {
				if (!isSameOriginRequest(req)) {
					logger.warn("Rejected cross-origin admin request", {
						method: req.method,
						url: req.url,
					});
					return new Response("Cross-origin request rejected", {status: 403});
				}
			}
		});

		if (authorize === "unsafe-allow-all") {
			logger.warn(
				'AdminRouter authorization is disabled ("unsafe-allow-all"). ' +
					"Do not use this in production.",
			);
		} else {
			this.use(async (req, ctx) => {
				const result = await authorize(req, ctx);
				if (result === true) {
					return;
				}
				if (result instanceof Response) {
					return result;
				}
				return new Response("Forbidden", {status: 403});
			});
		}

		// Normalize trailing slashes - strip them
		this.use(trailingSlash("strip"));

		// Store config for use in routes
		this.#title = config.branding?.title ?? "Admin";
		this.#assets = config.assets;
		logger.debug("Admin config", {
			title: this.#title,
			hasAssets: !!this.#assets,
		});

		// Introspect schema to get table info
		logger.debug("Introspecting schema...");
		const tables = getAdminSchemaInfo(config.schema);

		// Build model info array for navigation
		const models: AdminModel[] = [];
		for (const [name, tableInfo] of tables) {
			const modelConfig = config.models?.[name];
			models.push({
				name,
				displayName: modelConfig?.name ?? getDisplayName(name),
				tableInfo,
				table: tableInfo.table,
			});
		}

		// Sort models alphabetically
		models.sort((a, b) => a.displayName.localeCompare(b.displayName));
		this.models = models;

		// Register all routes
		this.#registerRoutes();
	}

	/** Get the database instance */
	#getDb(): Database {
		return self.databases.get(this.config.database) as Database;
	}

	/** Register all admin routes */
	#registerRoutes(): void {
		const {models, config} = this;
		const title = this.#title;
		const assets = this.#assets;
		const getDb = () => this.#getDb();

		// ============================================================================
		// Dashboard
		// ============================================================================

		this.route("/").get((req) => {
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
											<p>{m.tableInfo.columns.length} columns</p>
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
									Make sure your schema exports @b9g/zen collections.
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
		// CRUD Routes
		// ============================================================================

		// List view
		this.route("/:model").get(async (req, ctx) => {
			const modelName = ctx.params.model;
			const model = models.find((m) => m.name === modelName);

			if (!model) {
				return new Response("Model not found", {status: 404});
			}

			const basePath = getBasePath(req.url, "/:model");

			try {
				const db = getDb();
				const records = await db.all(model.table)``;

				// Get columns for display (exclude json types)
				const displayColumns = model.tableInfo.columns.filter(
					(c) => c.dataType !== "json",
				);

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

						{records.length === 0 ? (
							<div class="admin-empty">
								<p>No {model.displayName.toLowerCase()} found.</p>
								<a
									href={`${basePath}/${modelName}/new`}
									class="usa-button margin-top-2"
								>
									Create your first {model.displayName.toLowerCase()}
								</a>
							</div>
						) : (
							<div class="admin-card" style="overflow-x: auto;">
								<table class="usa-table usa-table--borderless">
									<thead>
										<tr>
											{displayColumns.map((col) => (
												<th scope="col">{col.name}</th>
											))}
											<th scope="col">Actions</th>
										</tr>
									</thead>
									<tbody>
										{records.map((record: Record<string, unknown>) => {
											const pk = getPrimaryKeyValue(record, model.tableInfo);
											return (
												<tr>
													{displayColumns.map((col) => (
														<td>{formatValue(record[col.name])}</td>
													))}
													<td>
														<a
															href={`${basePath}/${modelName}/${pk}`}
															class="usa-link margin-right-1"
														>
															View
														</a>
														<a
															href={`${basePath}/${modelName}/${pk}/edit`}
															class="usa-link margin-right-1"
														>
															Edit
														</a>
														<a
															href={`${basePath}/${modelName}/${pk}/delete`}
															class="usa-link text-secondary-dark"
														>
															Delete
														</a>
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						)}
					</PageLayout>,
				);
			} catch (err) {
				logger.error("List view error:", {error: err, model: modelName});
				return errorPage(title, basePath, models, err, assets);
			}
		});

		// Create form
		this.route("/:model/new").get((req, ctx) => {
			const modelName = ctx.params.model;
			const model = models.find((m) => m.name === modelName);

			if (!model) {
				return new Response("Model not found", {status: 404});
			}

			const basePath = getBasePath(req.url, "/:model/new");

			return html(
				<PageLayout
					title={title}
					pageTitle={`New ${model.displayName}`}
					basePath={basePath}
					models={models}
					assets={assets}
				>
					<h1 class="usa-heading">New {model.displayName}</h1>
					<div class="admin-card">
						<ModelForm
							tableInfo={model.tableInfo}
							action={`${basePath}/${modelName}/new`}
							submitLabel={`Create ${model.displayName}`}
							cancelUrl={`${basePath}/${modelName}`}
						/>
					</div>
				</PageLayout>,
			);
		});

		// Handle create
		this.route("/:model/new").post(async (req, ctx) => {
			const modelName = ctx.params.model;
			const model = models.find((m) => m.name === modelName);

			if (!model) {
				return new Response("Model not found", {status: 404});
			}

			const basePath = getBasePath(req.url, "/:model/new");

			// Parse formData once before try block - streams can only be consumed once
			const formData = await req.formData();
			const values = Object.fromEntries(formData.entries());

			try {
				const data = parseFormData(formData, model.tableInfo);

				const db = getDb();
				const created = await db.insert(model.table, data);
				const pk = getPrimaryKeyValue(created, model.tableInfo);

				return Response.redirect(`${basePath}/${modelName}/${pk}`, 303);
			} catch (err) {
				logger.error("Create error:", {error: err, model: modelName});

				// Handle validation errors by re-rendering form with preserved values
				if (err instanceof ValidationError) {
					const errors: Record<string, string> = {};
					for (const [field, messages] of Object.entries(
						err.fieldErrors ?? {},
					)) {
						errors[field] = Array.isArray(messages)
							? messages[0]
							: String(messages);
					}

					return html(
						<PageLayout
							title={title}
							pageTitle={`New ${model.displayName}`}
							basePath={basePath}
							models={models}
							assets={assets}
						>
							<h1 class="usa-heading">New {model.displayName}</h1>
							<div
								class="usa-alert usa-alert--error margin-bottom-2"
								role="alert"
							>
								<div class="usa-alert__body">
									<p class="usa-alert__text">
										Please correct the errors below.
									</p>
								</div>
							</div>
							<div class="admin-card">
								<ModelForm
									tableInfo={model.tableInfo}
									values={values}
									errors={errors}
									action={`${basePath}/${modelName}/new`}
									submitLabel={`Create ${model.displayName}`}
									cancelUrl={`${basePath}/${modelName}`}
								/>
							</div>
						</PageLayout>,
					);
				}

				return errorPage(title, basePath, models, err, assets);
			}
		});

		// Detail view
		this.route("/:model/:id").get(async (req, ctx) => {
			const modelName = ctx.params.model;
			const id = ctx.params.id;
			const model = models.find((m) => m.name === modelName);

			if (!model) {
				return new Response("Model not found", {status: 404});
			}

			const basePath = getBasePath(req.url, "/:model/:id");
			const parsedId = parseId(id, model.tableInfo);
			if (parsedId === null) {
				return new Response("Invalid ID", {status: 404});
			}

			try {
				const db = getDb();
				const record = await db.get(model.table, parsedId);

				if (!record) {
					return html(
						<PageLayout
							title={title}
							pageTitle="Not Found"
							basePath={basePath}
							models={models}
							assets={assets}
						>
							<h1 class="usa-heading">Not Found</h1>
							<div class="usa-alert usa-alert--warning" role="alert">
								<div class="usa-alert__body">
									<p class="usa-alert__text">
										{model.displayName} with ID "{id}" was not found.
									</p>
								</div>
							</div>
							<a
								href={`${basePath}/${modelName}`}
								class="usa-button margin-top-2"
							>
								Back to {model.displayName}
							</a>
						</PageLayout>,
					);
				}

				return html(
					<PageLayout
						title={title}
						pageTitle={`${model.displayName} #${id}`}
						basePath={basePath}
						models={models}
						assets={assets}
					>
						<div class="admin-header">
							<h1 class="usa-heading">
								{model.displayName} #{id}
							</h1>
							<div>
								<a
									href={`${basePath}/${modelName}/${id}/edit`}
									class="usa-button"
								>
									Edit
								</a>
								<a
									href={`${basePath}/${modelName}/${id}/delete`}
									class="usa-button usa-button--secondary margin-left-1"
								>
									Delete
								</a>
							</div>
						</div>

						<div class="admin-card admin-detail">
							<dl>
								{model.tableInfo.columns.map((col) => (
									<>
										<dt>{col.name}</dt>
										<dd>
											{formatValue(
												(record as Record<string, unknown>)[col.name],
											)}
										</dd>
									</>
								))}
							</dl>
						</div>

						<a
							href={`${basePath}/${modelName}`}
							class="usa-link margin-top-2"
							style="display: inline-block;"
						>
							← Back to {model.displayName}
						</a>
					</PageLayout>,
				);
			} catch (err) {
				logger.error("Detail view error:", {error: err, model: modelName, id});
				return errorPage(title, basePath, models, err, assets);
			}
		});

		// Edit form
		this.route("/:model/:id/edit").get(async (req, ctx) => {
			const modelName = ctx.params.model;
			const id = ctx.params.id;
			const model = models.find((m) => m.name === modelName);

			if (!model) {
				return new Response("Model not found", {status: 404});
			}

			const basePath = getBasePath(req.url, "/:model/:id/edit");
			const parsedId = parseId(id, model.tableInfo);
			if (parsedId === null) {
				return new Response("Invalid ID", {status: 404});
			}

			try {
				const db = getDb();
				const record = await db.get(model.table, parsedId);

				if (!record) {
					return html(
						<PageLayout
							title={title}
							pageTitle="Not Found"
							basePath={basePath}
							models={models}
							assets={assets}
						>
							<h1 class="usa-heading">Not Found</h1>
							<div class="usa-alert usa-alert--warning" role="alert">
								<div class="usa-alert__body">
									<p class="usa-alert__text">
										{model.displayName} with ID "{id}" was not found.
									</p>
								</div>
							</div>
							<a
								href={`${basePath}/${modelName}`}
								class="usa-button margin-top-2"
							>
								Back to {model.displayName}
							</a>
						</PageLayout>,
					);
				}

				return html(
					<PageLayout
						title={title}
						pageTitle={`Edit ${model.displayName} #${id}`}
						basePath={basePath}
						models={models}
						assets={assets}
					>
						<h1 class="usa-heading">
							Edit {model.displayName} #{id}
						</h1>
						<div class="admin-card">
							<ModelForm
								tableInfo={model.tableInfo}
								values={record as Record<string, unknown>}
								action={`${basePath}/${modelName}/${id}/edit`}
								submitLabel="Save Changes"
								cancelUrl={`${basePath}/${modelName}/${id}`}
							/>
						</div>
					</PageLayout>,
				);
			} catch (err) {
				logger.error("Edit form error:", {error: err, model: modelName, id});
				return errorPage(title, basePath, models, err, assets);
			}
		});

		// Handle edit
		this.route("/:model/:id/edit").post(async (req, ctx) => {
			const modelName = ctx.params.model;
			const id = ctx.params.id;
			const model = models.find((m) => m.name === modelName);

			if (!model) {
				return new Response("Model not found", {status: 404});
			}

			const basePath = getBasePath(req.url, "/:model/:id/edit");
			const parsedId = parseId(id, model.tableInfo);
			if (parsedId === null) {
				return new Response("Invalid ID", {status: 404});
			}

			// Parse formData once before try block - streams can only be consumed once
			const formData = await req.formData();
			const values = Object.fromEntries(formData.entries());

			try {
				const data = parseFormData(formData, model.tableInfo, {isUpdate: true});

				const db = getDb();
				await db.update(model.table, data, parsedId);

				return Response.redirect(`${basePath}/${modelName}/${id}`, 303);
			} catch (err) {
				logger.error("Update error:", {error: err, model: modelName, id});

				// Handle validation errors by re-rendering form with preserved values
				if (err instanceof ValidationError) {
					const errors: Record<string, string> = {};
					for (const [field, messages] of Object.entries(
						err.fieldErrors ?? {},
					)) {
						errors[field] = Array.isArray(messages)
							? messages[0]
							: String(messages);
					}

					return html(
						<PageLayout
							title={title}
							pageTitle={`Edit ${model.displayName} #${id}`}
							basePath={basePath}
							models={models}
							assets={assets}
						>
							<h1 class="usa-heading">
								Edit {model.displayName} #{id}
							</h1>
							<div
								class="usa-alert usa-alert--error margin-bottom-2"
								role="alert"
							>
								<div class="usa-alert__body">
									<p class="usa-alert__text">
										Please correct the errors below.
									</p>
								</div>
							</div>
							<div class="admin-card">
								<ModelForm
									tableInfo={model.tableInfo}
									values={values}
									errors={errors}
									action={`${basePath}/${modelName}/${id}/edit`}
									submitLabel="Save Changes"
									cancelUrl={`${basePath}/${modelName}/${id}`}
								/>
							</div>
						</PageLayout>,
					);
				}

				return errorPage(title, basePath, models, err, assets);
			}
		});

		// Delete confirmation
		this.route("/:model/:id/delete").get(async (req, ctx) => {
			const modelName = ctx.params.model;
			const id = ctx.params.id;
			const model = models.find((m) => m.name === modelName);

			if (!model) {
				return new Response("Model not found", {status: 404});
			}

			const basePath = getBasePath(req.url, "/:model/:id/delete");
			const parsedId = parseId(id, model.tableInfo);
			if (parsedId === null) {
				return new Response("Invalid ID", {status: 404});
			}

			try {
				const db = getDb();
				const record = await db.get(model.table, parsedId);

				if (!record) {
					return html(
						<PageLayout
							title={title}
							pageTitle="Not Found"
							basePath={basePath}
							models={models}
							assets={assets}
						>
							<h1 class="usa-heading">Not Found</h1>
							<div class="usa-alert usa-alert--warning" role="alert">
								<div class="usa-alert__body">
									<p class="usa-alert__text">
										{model.displayName} with ID "{id}" was not found.
									</p>
								</div>
							</div>
							<a
								href={`${basePath}/${modelName}`}
								class="usa-button margin-top-2"
							>
								Back to {model.displayName}
							</a>
						</PageLayout>,
					);
				}

				return html(
					<PageLayout
						title={title}
						pageTitle={`Delete ${model.displayName} #${id}`}
						basePath={basePath}
						models={models}
						assets={assets}
					>
						<h1 class="usa-heading">
							Delete {model.displayName} #{id}
						</h1>
						<div class="usa-alert usa-alert--warning" role="alert">
							<div class="usa-alert__body">
								<h4 class="usa-alert__heading">Confirm Deletion</h4>
								<p class="usa-alert__text">
									Are you sure you want to delete this{" "}
									{model.displayName.toLowerCase()}? This action cannot be
									undone.
								</p>
							</div>
						</div>

						<div class="admin-card admin-detail margin-top-2">
							<dl>
								{model.tableInfo.columns.slice(0, 5).map((col) => (
									<>
										<dt>{col.name}</dt>
										<dd>
											{formatValue(
												(record as Record<string, unknown>)[col.name],
											)}
										</dd>
									</>
								))}
							</dl>
						</div>

						<form
							method="POST"
							action={`${basePath}/${modelName}/${id}/delete`}
							class="margin-top-2"
						>
							<button type="submit" class="usa-button usa-button--secondary">
								Delete {model.displayName}
							</button>
							<a
								href={`${basePath}/${modelName}/${id}`}
								class="usa-button usa-button--outline margin-left-1"
							>
								Cancel
							</a>
						</form>
					</PageLayout>,
				);
			} catch (err) {
				logger.error("Delete confirmation error:", {
					error: err,
					model: modelName,
					id,
				});
				return errorPage(title, basePath, models, err, assets);
			}
		});

		// Handle delete
		this.route("/:model/:id/delete").post(async (req, ctx) => {
			const modelName = ctx.params.model;
			const id = ctx.params.id;
			const model = models.find((m) => m.name === modelName);

			if (!model) {
				return new Response("Model not found", {status: 404});
			}

			const basePath = getBasePath(req.url, "/:model/:id/delete");
			const parsedId = parseId(id, model.tableInfo);
			if (parsedId === null) {
				return new Response("Invalid ID", {status: 404});
			}

			try {
				const db = getDb();
				await db.delete(model.table, parsedId);

				return Response.redirect(`${basePath}/${modelName}`, 303);
			} catch (err) {
				logger.error("Delete error:", {error: err, model: modelName, id});
				return errorPage(title, basePath, models, err, assets);
			}
		});
	}
}

/**
 * Create an admin router (convenience factory)
 * @deprecated Use `new AdminRouter(config)` instead
 */
export function createAdmin(config: AdminConfig): AdminRouter {
	return new AdminRouter(config);
}

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
import type {Table, Database} from "@b9g/zen";
import {ValidationError} from "@b9g/zen";
import type {AdminConfig, TableMetadata, AssetsConfig} from "./types.js";
import {
	introspectSchema,
	isTable,
	getDisplayName,
} from "./core/introspection.js";
import {PageLayout} from "./ui/Layout.js";
import {ModelForm, parseFormData} from "./ui/Form.js";

const logger = self.loggers.get("shovel", "admin");

interface ModelInfo {
	name: string;
	displayName: string;
	metadata: TableMetadata;
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
 * Get the primary key value from a record
 */
function getPrimaryKeyValue(record: Record<string, unknown>, metadata: TableMetadata): string {
	if (metadata.primaryKey.length === 0) {
		throw new Error("Table has no primary key");
	}
	const pkField = metadata.primaryKey[0];
	const value = record[pkField];
	return String(value);
}

/**
 * Parse ID from URL parameter based on primary key type.
 * Returns null if the ID is invalid (e.g., non-numeric string for numeric PK).
 */
function parseId(id: string, metadata: TableMetadata): string | number | null {
	if (metadata.primaryKey.length === 0) {
		throw new Error("Table has no primary key");
	}
	const pkField = metadata.primaryKey[0];
	const pkColumn = metadata.columns.find((c) => c.key === pkField);
	if (pkColumn?.dataType === "number") {
		const parsed = parseInt(id, 10);
		if (Number.isNaN(parsed)) {
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
		const table = Object.values(config.schema).find(
			(c): c is Table<any> => isTable(c) && c.name === name,
		);
		if (table) {
			const modelConfig = config.models?.[name];
			models.push({
				name,
				displayName: modelConfig?.name ?? getDisplayName(name),
				metadata,
				table,
			});
		}
	}

	// Sort models alphabetically
	models.sort((a, b) => a.displayName.localeCompare(b.displayName));

	// Helper to get database
	const getDb = () => self.databases.get(config.database) as Database;

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
	router.route("/:model").get(async (req, ctx) => {
		const modelName = ctx.params.model;
		const model = models.find((m) => m.name === modelName);

		if (!model) {
			return new Response("Model not found", {status: 404});
		}

		const basePath = getBasePath(req.url, `/${modelName}`);

		try {
			const db = getDb();
			const records = await db.all(model.table)``;

			// Get columns for display (exclude blob types)
			const displayColumns = model.metadata.columns.filter(
				(c) => c.dataType !== "blob" && c.dataType !== "json",
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
										const pk = getPrimaryKeyValue(record, model.metadata);
										return (
											<tr>
												{displayColumns.map((col) => (
													<td>{formatValue(record[col.key])}</td>
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
				<div class="admin-card">
					<ModelForm
						metadata={model.metadata}
						action={`${basePath}/${modelName}/new`}
						submitLabel={`Create ${model.displayName}`}
						cancelUrl={`${basePath}/${modelName}`}
					/>
				</div>
			</PageLayout>,
		);
	});

	// Handle create
	router.route("/:model/new").post(async (req, ctx) => {
		const modelName = ctx.params.model;
		const model = models.find((m) => m.name === modelName);

		if (!model) {
			return new Response("Model not found", {status: 404});
		}

		const basePath = getBasePath(req.url, `/${modelName}/new`);

		// Parse formData once before try block - streams can only be consumed once
		const formData = await req.formData();
		const values = Object.fromEntries(formData.entries());

		try {
			const data = parseFormData(formData, model.metadata);

			const db = getDb();
			const created = await db.insert(model.table, data);
			const pk = getPrimaryKeyValue(created, model.metadata);

			return Response.redirect(`${basePath}/${modelName}/${pk}`, 303);
		} catch (err) {
			logger.error("Create error:", {error: err, model: modelName});

			// Handle validation errors by re-rendering form with preserved values
			if (err instanceof ValidationError) {
				const errors: Record<string, string> = {};
				for (const [field, messages] of Object.entries(err.fieldErrors ?? {})) {
					errors[field] = Array.isArray(messages) ? messages[0] : String(messages);
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
						<div class="usa-alert usa-alert--error margin-bottom-2" role="alert">
							<div class="usa-alert__body">
								<p class="usa-alert__text">
									Please correct the errors below.
								</p>
							</div>
						</div>
						<div class="admin-card">
							<ModelForm
								metadata={model.metadata}
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
	router.route("/:model/:id").get(async (req, ctx) => {
		const modelName = ctx.params.model;
		const id = ctx.params.id;
		const model = models.find((m) => m.name === modelName);

		if (!model) {
			return new Response("Model not found", {status: 404});
		}

		const basePath = getBasePath(req.url, `/${modelName}/${id}`);
		const parsedId = parseId(id, model.metadata);
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
						<a href={`${basePath}/${modelName}`} class="usa-button margin-top-2">
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
							{model.metadata.columns.map((col) => (
								<>
									<dt>{col.name}</dt>
									<dd>{formatValue((record as Record<string, unknown>)[col.key])}</dd>
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
	router.route("/:model/:id/edit").get(async (req, ctx) => {
		const modelName = ctx.params.model;
		const id = ctx.params.id;
		const model = models.find((m) => m.name === modelName);

		if (!model) {
			return new Response("Model not found", {status: 404});
		}

		const basePath = getBasePath(req.url, `/${modelName}/${id}/edit`);
		const parsedId = parseId(id, model.metadata);
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
						<a href={`${basePath}/${modelName}`} class="usa-button margin-top-2">
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
							metadata={model.metadata}
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
	router.route("/:model/:id/edit").post(async (req, ctx) => {
		const modelName = ctx.params.model;
		const id = ctx.params.id;
		const model = models.find((m) => m.name === modelName);

		if (!model) {
			return new Response("Model not found", {status: 404});
		}

		const basePath = getBasePath(req.url, `/${modelName}/${id}/edit`);
		const parsedId = parseId(id, model.metadata);
		if (parsedId === null) {
			return new Response("Invalid ID", {status: 404});
		}

		// Parse formData once before try block - streams can only be consumed once
		const formData = await req.formData();
		const values = Object.fromEntries(formData.entries());

		try {
			const data = parseFormData(formData, model.metadata, {isUpdate: true});

			const db = getDb();
			await db.update(model.table, data, parsedId);

			return Response.redirect(`${basePath}/${modelName}/${id}`, 303);
		} catch (err) {
			logger.error("Update error:", {error: err, model: modelName, id});

			// Handle validation errors by re-rendering form with preserved values
			if (err instanceof ValidationError) {
				const errors: Record<string, string> = {};
				for (const [field, messages] of Object.entries(err.fieldErrors ?? {})) {
					errors[field] = Array.isArray(messages) ? messages[0] : String(messages);
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
						<div class="usa-alert usa-alert--error margin-bottom-2" role="alert">
							<div class="usa-alert__body">
								<p class="usa-alert__text">
									Please correct the errors below.
								</p>
							</div>
						</div>
						<div class="admin-card">
							<ModelForm
								metadata={model.metadata}
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
	router.route("/:model/:id/delete").get(async (req, ctx) => {
		const modelName = ctx.params.model;
		const id = ctx.params.id;
		const model = models.find((m) => m.name === modelName);

		if (!model) {
			return new Response("Model not found", {status: 404});
		}

		const basePath = getBasePath(req.url, `/${modelName}/${id}/delete`);
		const parsedId = parseId(id, model.metadata);
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
						<a href={`${basePath}/${modelName}`} class="usa-button margin-top-2">
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
								Are you sure you want to delete this {model.displayName.toLowerCase()}?
								This action cannot be undone.
							</p>
						</div>
					</div>

					<div class="admin-card admin-detail margin-top-2">
						<dl>
							{model.metadata.columns.slice(0, 5).map((col) => (
								<>
									<dt>{col.name}</dt>
									<dd>{formatValue((record as Record<string, unknown>)[col.key])}</dd>
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
			logger.error("Delete confirmation error:", {error: err, model: modelName, id});
			return errorPage(title, basePath, models, err, assets);
		}
	});

	// Handle delete
	router.route("/:model/:id/delete").post(async (req, ctx) => {
		const modelName = ctx.params.model;
		const id = ctx.params.id;
		const model = models.find((m) => m.name === modelName);

		if (!model) {
			return new Response("Model not found", {status: 404});
		}

		const basePath = getBasePath(req.url, `/${modelName}/${id}/delete`);
		const parsedId = parseId(id, model.metadata);
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

	return router;
}

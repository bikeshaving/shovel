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
import {getTableName, isTable, type Table} from "drizzle-orm";
import type {DrizzleInstance} from "@b9g/platform/runtime";
import type {AdminConfig, TableMetadata, ColumnMetadata} from "./types.js";
import {
	introspectSchema,
	getDisplayName,
	type GetTableConfigFn,
} from "./core/introspection.js";
import {PageLayout} from "./ui/Layout.js";

const logger = self.loggers.get("shovel", "admin");

interface ModelInfo {
	name: string;
	displayName: string;
	metadata: TableMetadata;
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
	const tables = introspectSchema(
		config.schema,
		config.getTableConfig as GetTableConfigFn,
	);

	// Build model info array for navigation
	const models: ModelInfo[] = [];
	for (const [name, metadata] of tables) {
		const modelConfig = config.models?.[name];
		models.push({
			name,
			displayName: modelConfig?.name ?? getDisplayName(name),
			metadata,
		});
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
								Make sure your schema exports Drizzle tables.
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

		let records: Record<string, unknown>[] = [];
		let dbError: unknown = null;

		try {
			// Get database and query records
			const db = (await self.databases.open(
				config.database,
			)) as DrizzleInstance;
			const table = Object.values(config.schema).find(
				(t: unknown) => isTable(t) && getTableName(t as Table) === modelName,
			);

			if (table) {
				records = await (db as any).select().from(table);
			}
		} catch (err) {
			dbError = err;
		}

		// Determine which columns to display
		const modelConfig = config.models?.[modelName];
		const listFields =
			modelConfig?.listFields ??
			model.metadata.columns
				.filter((c) => c.dataType !== "blob")
				.slice(0, 6)
				.map((c) => c.name);

		return html(
			<PageLayout
				title={title}
				pageTitle={model.displayName}
				basePath={basePath}
				models={models}
				assets={assets}
			>
				<nav class="usa-breadcrumb admin-breadcrumb" aria-label="Breadcrumbs">
					<ol class="usa-breadcrumb__list">
						<li class="usa-breadcrumb__list-item">
							<a href={basePath} class="usa-breadcrumb__link">
								Dashboard
							</a>
						</li>
						<li
							class="usa-breadcrumb__list-item usa-current"
							aria-current="page"
						>
							<span>{model.displayName}</span>
						</li>
					</ol>
				</nav>

				<div class="admin-header">
					<h1 class="usa-heading">{model.displayName}</h1>
					<a href={`${basePath}/${modelName}/new`} class="usa-button">
						Add {model.displayName}
					</a>
				</div>

				{dbError && (
					<div class="usa-alert usa-alert--error margin-bottom-2" role="alert">
						<div class="usa-alert__body">
							<h4 class="usa-alert__heading">Database error</h4>
							<p class="usa-alert__text">
								{dbError instanceof Error ? dbError.message : String(dbError)}
							</p>
						</div>
					</div>
				)}

				{!dbError && records.length > 0 ? (
					<table class="usa-table usa-table--striped">
						<thead>
							<tr>
								{listFields.map((field) => (
									<th scope="col">{field}</th>
								))}
								<th scope="col">Actions</th>
							</tr>
						</thead>
						<tbody>
							{records.map((record) => {
								const pk = model.metadata.primaryKey[0];
								const id = record[pk];
								return (
									<tr>
										{listFields.map((field) => (
											<td>{formatValue(record[field])}</td>
										))}
										<td>
											<a
												href={`${basePath}/${modelName}/${id}`}
												class="usa-button usa-button--outline usa-button--unstyled"
											>
												View
											</a>{" "}
											<a
												href={`${basePath}/${modelName}/${id}/edit`}
												class="usa-button usa-button--outline usa-button--unstyled"
											>
												Edit
											</a>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				) : (
					!dbError && (
						<div class="admin-empty">
							<p>No {model.displayName.toLowerCase()} found.</p>
							<p class="margin-top-1">
								<a href={`${basePath}/${modelName}/new`} class="usa-link">
									Create your first {model.displayName.toLowerCase()}
								</a>
							</p>
						</div>
					)
				)}
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
		const modelConfig = config.models?.[modelName];
		const excludeFields = modelConfig?.excludeFields ?? [];

		// Get editable columns (exclude primary keys with defaults, excluded fields)
		const editableColumns = model.metadata.columns.filter(
			(col) =>
				!excludeFields.includes(col.name) &&
				!(col.isPrimaryKey && col.hasDefault) &&
				col.dataType !== "blob",
		);

		return html(
			<PageLayout
				title={title}
				pageTitle={`New ${model.displayName}`}
				basePath={basePath}
				models={models}
				assets={assets}
			>
				<nav class="usa-breadcrumb admin-breadcrumb" aria-label="Breadcrumbs">
					<ol class="usa-breadcrumb__list">
						<li class="usa-breadcrumb__list-item">
							<a href={basePath} class="usa-breadcrumb__link">
								Dashboard
							</a>
						</li>
						<li class="usa-breadcrumb__list-item">
							<a href={`${basePath}/${modelName}`} class="usa-breadcrumb__link">
								{model.displayName}
							</a>
						</li>
						<li
							class="usa-breadcrumb__list-item usa-current"
							aria-current="page"
						>
							<span>New</span>
						</li>
					</ol>
				</nav>

				<h1 class="usa-heading">New {model.displayName}</h1>

				<div class="admin-card">
					<form
						class="usa-form admin-form"
						method="POST"
						action={`${basePath}/${modelName}/new`}
					>
						{editableColumns.map((col) => (
							<div class="usa-form-group">
								<label class="usa-label" for={col.name}>
									{getDisplayName(col.name)}
									{col.notNull && !col.hasDefault && (
										<span class="text-secondary-dark"> *</span>
									)}
								</label>
								{renderFormField(col)}
							</div>
						))}

						<div class="admin-form-actions">
							<button type="submit" class="usa-button">
								Create {model.displayName}
							</button>
							<a
								href={`${basePath}/${modelName}`}
								class="usa-button usa-button--outline"
							>
								Cancel
							</a>
						</div>
					</form>
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

		// Parse form data
		const formData = await req.formData();
		const data: Record<string, unknown> = {};

		for (const col of model.metadata.columns) {
			// Form field uses DB column name, but Drizzle expects JS property key
			const value = formData.get(col.name);
			if (value !== null && value !== "") {
				data[col.key] = parseFormValue(value as string, col);
			}
		}

		try {
			// Insert into database
			const db = (await self.databases.open(
				config.database,
			)) as DrizzleInstance;
			const table = Object.values(config.schema).find(
				(t: unknown) => isTable(t) && getTableName(t as Table) === modelName,
			);

			logger.debug("Insert attempt", {modelName, tableFound: !!table, data});

			if (table) {
				await (db as any).insert(table).values(data);
				logger.info("Insert successful", {modelName});
			} else {
				logger.warn("Table not found for model", {modelName});
			}
		} catch (err) {
			logger.error("Insert error", {modelName, error: err});
			return errorPage(title, basePath, models, err, assets);
		}

		// Redirect to list view
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

		let record: Record<string, unknown> | undefined;
		try {
			// Get database and query record
			const db = (await self.databases.open(
				config.database,
			)) as DrizzleInstance;
			const table = Object.values(config.schema).find(
				(t: unknown) => isTable(t) && getTableName(t as Table) === modelName,
			) as {[key: string]: unknown} | undefined;

			if (table) {
				const pk = model.metadata.primaryKey[0];

				const pkColumn = (table as any)[pk];
				const {eq} = await import("drizzle-orm");
				const results = (await db
					.select()

					.from(table as any)
					.where(eq(pkColumn, coercePrimaryKey(id, model.metadata)))) as Record<
					string,
					unknown
				>[];
				record = results[0];
			}
		} catch (err) {
			return errorPage(title, basePath, models, err, assets);
		}

		if (!record) {
			return new Response("Record not found", {status: 404});
		}

		return html(
			<PageLayout
				title={title}
				pageTitle={`${model.displayName} #${id}`}
				basePath={basePath}
				models={models}
				assets={assets}
			>
				<nav class="usa-breadcrumb admin-breadcrumb" aria-label="Breadcrumbs">
					<ol class="usa-breadcrumb__list">
						<li class="usa-breadcrumb__list-item">
							<a href={basePath} class="usa-breadcrumb__link">
								Dashboard
							</a>
						</li>
						<li class="usa-breadcrumb__list-item">
							<a href={`${basePath}/${modelName}`} class="usa-breadcrumb__link">
								{model.displayName}
							</a>
						</li>
						<li
							class="usa-breadcrumb__list-item usa-current"
							aria-current="page"
						>
							<span>#{id}</span>
						</li>
					</ol>
				</nav>

				<div class="admin-header">
					<h1 class="usa-heading">
						{model.displayName} #{id}
					</h1>
					<div class="usa-button-group">
						<a href={`${basePath}/${modelName}/${id}/edit`} class="usa-button">
							Edit
						</a>
						<a
							href={`${basePath}/${modelName}/${id}/delete`}
							class="usa-button usa-button--secondary"
						>
							Delete
						</a>
					</div>
				</div>

				<div class="admin-card admin-detail">
					<dl>
						{model.metadata.columns.map((col) => (
							<>
								<dt>{getDisplayName(col.name)}</dt>
								<dd>{formatValue(record![col.name])}</dd>
							</>
						))}
					</dl>
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
		const modelConfig = config.models?.[modelName];
		const excludeFields = modelConfig?.excludeFields ?? [];
		const readOnlyFields = modelConfig?.readOnlyFields ?? [];

		let record: Record<string, unknown> | undefined;
		try {
			// Get database and query record
			const db = (await self.databases.open(
				config.database,
			)) as DrizzleInstance;
			const table = Object.values(config.schema).find(
				(t: unknown) => isTable(t) && getTableName(t as Table) === modelName,
			) as {[key: string]: unknown} | undefined;

			if (table) {
				const pk = model.metadata.primaryKey[0];

				const pkColumn = (table as any)[pk];
				const {eq} = await import("drizzle-orm");
				const results = (await db
					.select()

					.from(table as any)
					.where(eq(pkColumn, coercePrimaryKey(id, model.metadata)))) as Record<
					string,
					unknown
				>[];
				record = results[0];
			}
		} catch (err) {
			return errorPage(title, basePath, models, err, assets);
		}

		if (!record) {
			return new Response("Record not found", {status: 404});
		}

		// Get editable columns
		const editableColumns = model.metadata.columns.filter(
			(col) =>
				!excludeFields.includes(col.name) &&
				!col.isPrimaryKey &&
				col.dataType !== "blob",
		);

		return html(
			<PageLayout
				title={title}
				pageTitle={`Edit ${model.displayName} #${id}`}
				basePath={basePath}
				models={models}
				assets={assets}
			>
				<nav class="usa-breadcrumb admin-breadcrumb" aria-label="Breadcrumbs">
					<ol class="usa-breadcrumb__list">
						<li class="usa-breadcrumb__list-item">
							<a href={basePath} class="usa-breadcrumb__link">
								Dashboard
							</a>
						</li>
						<li class="usa-breadcrumb__list-item">
							<a href={`${basePath}/${modelName}`} class="usa-breadcrumb__link">
								{model.displayName}
							</a>
						</li>
						<li class="usa-breadcrumb__list-item">
							<a
								href={`${basePath}/${modelName}/${id}`}
								class="usa-breadcrumb__link"
							>
								#{id}
							</a>
						</li>
						<li
							class="usa-breadcrumb__list-item usa-current"
							aria-current="page"
						>
							<span>Edit</span>
						</li>
					</ol>
				</nav>

				<h1 class="usa-heading">Edit {model.displayName}</h1>

				<div class="admin-card">
					<form
						class="usa-form admin-form"
						method="POST"
						action={`${basePath}/${modelName}/${id}/edit`}
					>
						{editableColumns.map((col) => (
							<div class="usa-form-group">
								<label class="usa-label" for={col.name}>
									{getDisplayName(col.name)}
									{col.notNull && <span class="text-secondary-dark"> *</span>}
								</label>
								{renderFormField(
									col,
									record![col.name],
									readOnlyFields.includes(col.name),
								)}
							</div>
						))}

						<div class="admin-form-actions">
							<button type="submit" class="usa-button">
								Save Changes
							</button>
							<a
								href={`${basePath}/${modelName}/${id}`}
								class="usa-button usa-button--outline"
							>
								Cancel
							</a>
						</div>
					</form>
				</div>
			</PageLayout>,
		);
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
		const modelConfig = config.models?.[modelName];
		const excludeFields = modelConfig?.excludeFields ?? [];
		const readOnlyFields = modelConfig?.readOnlyFields ?? [];

		// Parse form data
		const formData = await req.formData();
		const data: Record<string, unknown> = {};

		for (const col of model.metadata.columns) {
			if (
				col.isPrimaryKey ||
				excludeFields.includes(col.name) ||
				readOnlyFields.includes(col.name)
			) {
				continue;
			}

			const value = formData.get(col.name);
			if (value !== null) {
				// Form field uses DB column name, but Drizzle expects JS property key
				data[col.key] =
					value === "" ? null : parseFormValue(value as string, col);
			}
		}

		try {
			// Update in database
			const db = (await self.databases.open(
				config.database,
			)) as DrizzleInstance;
			const table = Object.values(config.schema).find(
				(t: unknown) => isTable(t) && getTableName(t as Table) === modelName,
			) as {[key: string]: unknown} | undefined;

			if (table) {
				const pk = model.metadata.primaryKey[0];

				const pkColumn = (table as any)[pk];
				const {eq} = await import("drizzle-orm");
				await db
					.update(table as never)
					.set(data)
					.where(eq(pkColumn, coercePrimaryKey(id, model.metadata)));
			}
		} catch (err) {
			return errorPage(title, basePath, models, err, assets);
		}

		// Redirect to detail view
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
				<nav class="usa-breadcrumb admin-breadcrumb" aria-label="Breadcrumbs">
					<ol class="usa-breadcrumb__list">
						<li class="usa-breadcrumb__list-item">
							<a href={basePath} class="usa-breadcrumb__link">
								Dashboard
							</a>
						</li>
						<li class="usa-breadcrumb__list-item">
							<a href={`${basePath}/${modelName}`} class="usa-breadcrumb__link">
								{model.displayName}
							</a>
						</li>
						<li class="usa-breadcrumb__list-item">
							<a
								href={`${basePath}/${modelName}/${id}`}
								class="usa-breadcrumb__link"
							>
								#{id}
							</a>
						</li>
						<li
							class="usa-breadcrumb__list-item usa-current"
							aria-current="page"
						>
							<span>Delete</span>
						</li>
					</ol>
				</nav>

				<h1 class="usa-heading">Delete {model.displayName}</h1>

				<div class="admin-card">
					<div
						class="usa-alert usa-alert--warning margin-bottom-2"
						role="alert"
					>
						<div class="usa-alert__body">
							<h4 class="usa-alert__heading">Warning</h4>
							<p class="usa-alert__text">This action cannot be undone.</p>
						</div>
					</div>

					<p class="usa-prose margin-bottom-2">
						Are you sure you want to delete {model.displayName} #{id}?
					</p>

					<form method="POST" action={`${basePath}/${modelName}/${id}/delete`}>
						<div class="admin-form-actions">
							<button type="submit" class="usa-button usa-button--secondary">
								Yes, Delete
							</button>
							<a
								href={`${basePath}/${modelName}/${id}`}
								class="usa-button usa-button--outline"
							>
								Cancel
							</a>
						</div>
					</form>
				</div>
			</PageLayout>,
		);
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

		try {
			// Delete from database
			const db = (await self.databases.open(
				config.database,
			)) as DrizzleInstance;
			const table = Object.values(config.schema).find(
				(t: unknown) => isTable(t) && getTableName(t as Table) === modelName,
			) as {[key: string]: unknown} | undefined;

			if (table) {
				const pk = model.metadata.primaryKey[0];

				const pkColumn = (table as any)[pk];
				const {eq} = await import("drizzle-orm");
				await db
					.delete(table as never)
					.where(eq(pkColumn, coercePrimaryKey(id, model.metadata)));
			}
		} catch (err) {
			return errorPage(title, basePath, models, err, assets);
		}

		// Redirect to list view
		return Response.redirect(`${basePath}/${modelName}`, 303);
	});

	return router;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format a value for display in tables/detail views
 */
function formatValue(value: unknown): string {
	if (value === null || value === undefined) {
		return "-";
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
 * Render a form field based on column metadata
 */
function renderFormField(
	col: ColumnMetadata,
	value?: unknown,
	readOnly?: boolean,
) {
	const strValue = value !== null && value !== undefined ? String(value) : "";
	const disabled = readOnly ? {disabled: true} : {};

	// Enum columns get a select
	if (col.enumValues) {
		return (
			<select class="usa-select" name={col.name} id={col.name} {...disabled}>
				{!col.notNull && <option value="">-- Select --</option>}
				{col.enumValues.map((v) => (
					<option value={v} selected={v === strValue}>
						{v}
					</option>
				))}
			</select>
		);
	}

	// Type-specific inputs
	switch (col.dataType) {
		case "boolean":
			return (
				<select class="usa-select" name={col.name} id={col.name} {...disabled}>
					{!col.notNull && <option value="">-- Select --</option>}
					<option value="true" selected={strValue === "true"}>
						Yes
					</option>
					<option value="false" selected={strValue === "false"}>
						No
					</option>
				</select>
			);

		case "number":
			return (
				<input
					class="usa-input"
					type="number"
					name={col.name}
					id={col.name}
					value={strValue}
					step="any"
					required={col.notNull && !col.hasDefault}
					{...disabled}
				/>
			);

		case "date":
			return (
				<input
					class="usa-input"
					type="date"
					name={col.name}
					id={col.name}
					value={strValue}
					required={col.notNull && !col.hasDefault}
					{...disabled}
				/>
			);

		case "datetime":
			return (
				<input
					class="usa-input"
					type="datetime-local"
					name={col.name}
					id={col.name}
					value={strValue}
					required={col.notNull && !col.hasDefault}
					{...disabled}
				/>
			);

		case "json":
			return (
				<textarea
					class="usa-textarea"
					name={col.name}
					id={col.name}
					required={col.notNull && !col.hasDefault}
					{...disabled}
				>
					{typeof value === "object"
						? JSON.stringify(value, null, 2)
						: strValue}
				</textarea>
			);

		default:
			// Check if it's likely a long text field
			if (
				col.sqlType.toLowerCase().includes("text") &&
				!col.sqlType.toLowerCase().includes("varchar")
			) {
				return (
					<textarea
						class="usa-textarea"
						name={col.name}
						id={col.name}
						required={col.notNull && !col.hasDefault}
						{...disabled}
					>
						{strValue}
					</textarea>
				);
			}

			return (
				<input
					class="usa-input"
					type="text"
					name={col.name}
					id={col.name}
					value={strValue}
					required={col.notNull && !col.hasDefault}
					{...disabled}
				/>
			);
	}
}

/**
 * Parse a form value based on column metadata
 */
function parseFormValue(value: string, col: ColumnMetadata): unknown {
	switch (col.dataType) {
		case "boolean":
			return value === "true";

		case "number":
			return parseFloat(value);

		case "date":
		case "datetime":
			return new Date(value);

		case "json":
			try {
				return JSON.parse(value);
			} catch {
				return value;
			}

		default:
			return value;
	}
}

/**
 * Coerce a primary key value from URL to the correct type
 */
function coercePrimaryKey(value: string, metadata: TableMetadata): unknown {
	const pkCol = metadata.columns.find((c) =>
		metadata.primaryKey.includes(c.name),
	);
	if (pkCol?.dataType === "number") {
		return parseInt(value, 10);
	}
	return value;
}

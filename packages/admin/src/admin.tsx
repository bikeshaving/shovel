/**
 * @b9g/admin - Main admin factory
 *
 * Creates a mountable Router with admin routes using Crank.js for rendering.
 */

import {Router} from "@b9g/router";
import {trailingSlash} from "@b9g/router/middleware";
import {renderer} from "@b9g/crank/html";
import type {AdminConfig, TableMetadata} from "./types.js";
import {introspectSchema, getDisplayName} from "./core/introspection.js";
import {PageLayout} from "./ui/Layout.js";

type GetTableConfigFn = (table: unknown) => unknown;

interface ModelInfo {
	name: string;
	displayName: string;
	metadata: TableMetadata;
}

/**
 * Render a JSX element to an HTML Response
 */
function html(element: unknown): Response {
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
): Response {
	const message = error instanceof Error ? error.message : String(error);
	const stack = error instanceof Error ? error.stack : undefined;

	return html(
		<PageLayout title={title} pageTitle="Error" basePath={basePath} models={models}>
			<h1>Error</h1>
			<div class="alert alert-error">
				<strong>Something went wrong:</strong>
				<pre style="margin-top: 0.5rem; white-space: pre-wrap;">{message}</pre>
			</div>
			{stack && (
				<details style="margin-top: 1rem;">
					<summary style="cursor: pointer;">Stack trace</summary>
					<pre
						style="margin-top: 0.5rem; padding: 1rem; background: #1b1b1b; color: #fff; overflow-x: auto; font-size: 0.875rem;"
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
	const router = new Router();

	// Normalize trailing slashes - strip them
	router.use(trailingSlash("strip"));

	// Store config for use in routes
	const title = config.branding?.title ?? "Admin";

	// Introspect schema to get table metadata
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
	// Static Assets
	// ============================================================================

	router.route("/static/*path").get((_req, ctx) => {
		const path = ctx.params.path;
		return new Response(`Static file: ${path}`, {
			status: 404,
			headers: {"Content-Type": "text/plain"},
		});
	});

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
			>
				<h1>Login</h1>
				<div class="card">
					<p style="margin-bottom: 1rem;">Choose a provider to sign in:</p>
					<div class="actions">
						{config.auth.providers.map((p) => (
							<a href={`${basePath}/auth/${p}`} class="btn">
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
		const basePath = getBasePath(req.url, "/");

		return html(
			<PageLayout
				title={title}
				pageTitle="Dashboard"
				basePath={basePath}
				models={models}
			>
				<h1>Dashboard</h1>
				<p style="color: #71767a; margin-bottom: 1.5rem;">
					Database: {config.database}
				</p>

				<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 1rem;">
					{models.map((m) => (
						<div class="card">
							<h2 style="margin-bottom: 0.5rem;">
								<a href={`${basePath}/${m.name}`}>{m.displayName}</a>
							</h2>
							<p style="color: #71767a; font-size: 0.875rem;">
								{m.metadata.columns.length} columns
							</p>
							<div style="margin-top: 1rem;">
								<a href={`${basePath}/${m.name}/new`} class="btn btn-sm">
									Add
								</a>
							</div>
						</div>
					))}
				</div>

				{models.length === 0 && (
					<div class="empty">
						<p>No models found in schema.</p>
						<p style="margin-top: 0.5rem; font-size: 0.875rem;">
							Make sure your schema exports Drizzle tables.
						</p>
					</div>
				)}
			</PageLayout>,
		);
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
			const db = await self.databases.open(config.database);
			const table = Object.values(config.schema).find(
				(t: unknown) =>
					t &&
					typeof t === "object" &&
					"_" in t &&
					(t as {_: {name: string}})._.name === modelName,
			);

			if (table) {
				records = (await db.select().from(table as never)) as Record<
					string,
					unknown
				>[];
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
			>
				<div class="breadcrumb">
					<a href={basePath}>Dashboard</a> / {model.displayName}
				</div>

				<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
					<h1>{model.displayName}</h1>
					<a href={`${basePath}/${modelName}/new`} class="btn">
						Add {model.displayName}
					</a>
				</div>

				{dbError && (
					<div class="alert alert-error">
						<strong>Database error:</strong>
						<pre style="margin-top: 0.5rem; white-space: pre-wrap;">
							{dbError instanceof Error ? dbError.message : String(dbError)}
						</pre>
					</div>
				)}

				{!dbError && records.length > 0 ? (
					<table>
						<thead>
							<tr>
								{listFields.map((field) => (
									<th>{field}</th>
								))}
								<th>Actions</th>
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
										<td class="actions">
											<a
												href={`${basePath}/${modelName}/${id}`}
												class="btn btn-sm btn-secondary"
											>
												View
											</a>
											<a
												href={`${basePath}/${modelName}/${id}/edit`}
												class="btn btn-sm"
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
						<div class="empty">
							<p>No {model.displayName.toLowerCase()} found.</p>
							<p style="margin-top: 0.5rem;">
								<a href={`${basePath}/${modelName}/new`}>
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
			>
				<div class="breadcrumb">
					<a href={basePath}>Dashboard</a> /{" "}
					<a href={`${basePath}/${modelName}`}>{model.displayName}</a> / New
				</div>

				<h1>New {model.displayName}</h1>

				<div class="card">
					<form method="POST" action={`${basePath}/${modelName}/new`}>
						{editableColumns.map((col) => (
							<div class="form-group">
								<label for={col.name}>
									{getDisplayName(col.name)}
									{col.notNull && !col.hasDefault && (
										<span style="color: #b50909;"> *</span>
									)}
								</label>
								{renderFormField(col)}
							</div>
						))}

						<div class="form-actions">
							<button type="submit" class="btn">
								Create {model.displayName}
							</button>
							<a href={`${basePath}/${modelName}`} class="btn btn-secondary">
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
			const value = formData.get(col.name);
			if (value !== null && value !== "") {
				data[col.name] = parseFormValue(value as string, col);
			}
		}

		try {
			// Insert into database
			const db = await self.databases.open(config.database);
			const table = Object.values(config.schema).find(
				(t: unknown) =>
					t &&
					typeof t === "object" &&
					"_" in t &&
					(t as {_: {name: string}})._.name === modelName,
			);

			if (table) {
				await db.insert(table as never).values(data);
			}
		} catch (err) {
			return errorPage(title, basePath, models, err);
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
			const db = await self.databases.open(config.database);
			const table = Object.values(config.schema).find(
				(t: unknown) =>
					t &&
					typeof t === "object" &&
					"_" in t &&
					(t as {_: {name: string}})._.name === modelName,
			) as {[key: string]: unknown} | undefined;

			if (table) {
				const pk = model.metadata.primaryKey[0];
				const pkColumn = table[pk] as unknown;
				const {eq} = await import("drizzle-orm");
				const results = (await db
					.select()
					.from(table as never)
					.where(eq(pkColumn, coercePrimaryKey(id, model.metadata)))) as Record<
					string,
					unknown
				>[];
				record = results[0];
			}
		} catch (err) {
			return errorPage(title, basePath, models, err);
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
			>
				<div class="breadcrumb">
					<a href={basePath}>Dashboard</a> /{" "}
					<a href={`${basePath}/${modelName}`}>{model.displayName}</a> / #{id}
				</div>

				<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
					<h1>
						{model.displayName} #{id}
					</h1>
					<div class="actions">
						<a href={`${basePath}/${modelName}/${id}/edit`} class="btn">
							Edit
						</a>
						<a href={`${basePath}/${modelName}/${id}/delete`} class="btn btn-danger">
							Delete
						</a>
					</div>
				</div>

				<div class="card">
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
			const db = await self.databases.open(config.database);
			const table = Object.values(config.schema).find(
				(t: unknown) =>
					t &&
					typeof t === "object" &&
					"_" in t &&
					(t as {_: {name: string}})._.name === modelName,
			) as {[key: string]: unknown} | undefined;

			if (table) {
				const pk = model.metadata.primaryKey[0];
				const pkColumn = table[pk] as unknown;
				const {eq} = await import("drizzle-orm");
				const results = (await db
					.select()
					.from(table as never)
					.where(eq(pkColumn, coercePrimaryKey(id, model.metadata)))) as Record<
					string,
					unknown
				>[];
				record = results[0];
			}
		} catch (err) {
			return errorPage(title, basePath, models, err);
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
			>
				<div class="breadcrumb">
					<a href={basePath}>Dashboard</a> /{" "}
					<a href={`${basePath}/${modelName}`}>{model.displayName}</a> /{" "}
					<a href={`${basePath}/${modelName}/${id}`}>#{id}</a> / Edit
				</div>

				<h1>Edit {model.displayName}</h1>

				<div class="card">
					<form method="POST" action={`${basePath}/${modelName}/${id}/edit`}>
						{editableColumns.map((col) => (
							<div class="form-group">
								<label for={col.name}>
									{getDisplayName(col.name)}
									{col.notNull && <span style="color: #b50909;"> *</span>}
								</label>
								{renderFormField(
									col,
									record![col.name],
									readOnlyFields.includes(col.name),
								)}
							</div>
						))}

						<div class="form-actions">
							<button type="submit" class="btn">
								Save Changes
							</button>
							<a href={`${basePath}/${modelName}/${id}`} class="btn btn-secondary">
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
				data[col.name] = value === "" ? null : parseFormValue(value as string, col);
			}
		}

		try {
			// Update in database
			const db = await self.databases.open(config.database);
			const table = Object.values(config.schema).find(
				(t: unknown) =>
					t &&
					typeof t === "object" &&
					"_" in t &&
					(t as {_: {name: string}})._.name === modelName,
			) as {[key: string]: unknown} | undefined;

			if (table) {
				const pk = model.metadata.primaryKey[0];
				const pkColumn = table[pk] as unknown;
				const {eq} = await import("drizzle-orm");
				await db
					.update(table as never)
					.set(data)
					.where(eq(pkColumn, coercePrimaryKey(id, model.metadata)));
			}
		} catch (err) {
			return errorPage(title, basePath, models, err);
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
			>
				<div class="breadcrumb">
					<a href={basePath}>Dashboard</a> /{" "}
					<a href={`${basePath}/${modelName}`}>{model.displayName}</a> /{" "}
					<a href={`${basePath}/${modelName}/${id}`}>#{id}</a> / Delete
				</div>

				<h1>Delete {model.displayName}</h1>

				<div class="card">
					<div class="alert alert-error">
						<strong>Warning:</strong> This action cannot be undone.
					</div>

					<p style="margin-bottom: 1rem;">
						Are you sure you want to delete {model.displayName} #{id}?
					</p>

					<form method="POST" action={`${basePath}/${modelName}/${id}/delete`}>
						<div class="form-actions">
							<button type="submit" class="btn btn-danger">
								Yes, Delete
							</button>
							<a href={`${basePath}/${modelName}/${id}`} class="btn btn-secondary">
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
			const db = await self.databases.open(config.database);
			const table = Object.values(config.schema).find(
				(t: unknown) =>
					t &&
					typeof t === "object" &&
					"_" in t &&
					(t as {_: {name: string}})._.name === modelName,
			) as {[key: string]: unknown} | undefined;

			if (table) {
				const pk = model.metadata.primaryKey[0];
				const pkColumn = table[pk] as unknown;
				const {eq} = await import("drizzle-orm");
				await db
					.delete(table as never)
					.where(eq(pkColumn, coercePrimaryKey(id, model.metadata)));
			}
		} catch (err) {
			return errorPage(title, basePath, models, err);
		}

		// Redirect to list view
		return Response.redirect(`${basePath}/${modelName}`, 303);
	});

	return router;
}

// ============================================================================
// Helper Functions
// ============================================================================

import type {ColumnMetadata, TableMetadata} from "./types.js";

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
			<select name={col.name} id={col.name} {...disabled}>
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
				<select name={col.name} id={col.name} {...disabled}>
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
					name={col.name}
					id={col.name}
					required={col.notNull && !col.hasDefault}
					{...disabled}
				>
					{typeof value === "object" ? JSON.stringify(value, null, 2) : strValue}
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

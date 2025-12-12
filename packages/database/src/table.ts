/**
 * Table definition with wrapper-based field extensions.
 *
 * Uses wrapper functions instead of .pipe() to avoid Zod internals.
 * Metadata is extracted once at table() call time.
 */

import {z, ZodTypeAny, ZodObject, ZodRawShape} from "zod";

// ============================================================================
// Wrapper Types
// ============================================================================

const DB_FIELD = Symbol.for("@b9g/database:field");

interface FieldWrapper<T extends ZodTypeAny = ZodTypeAny> {
	[DB_FIELD]: true;
	schema: T;
	meta: FieldDbMeta;
}

function isFieldWrapper(value: unknown): value is FieldWrapper {
	return (
		value !== null &&
		typeof value === "object" &&
		DB_FIELD in value &&
		(value as any)[DB_FIELD] === true
	);
}

function createWrapper<T extends ZodTypeAny>(
	schema: T,
	meta: FieldDbMeta,
): FieldWrapper<T> {
	return {
		[DB_FIELD]: true,
		schema,
		meta,
	};
}

// ============================================================================
// Field Metadata
// ============================================================================

export interface FieldDbMeta {
	primaryKey?: boolean;
	unique?: boolean;
	indexed?: boolean;
	reference?: {
		table: Table<any>;
		field?: string; // defaults to primary key
		as: string;
		onDelete?: "cascade" | "set null" | "restrict";
	};
}

// ============================================================================
// Field Wrappers
// ============================================================================

/**
 * Mark a field as the primary key.
 *
 * @example
 * id: primary(z.string().uuid())
 */
export function primary<T extends ZodTypeAny>(schema: T): FieldWrapper<T> {
	return createWrapper(schema, {primaryKey: true});
}

/**
 * Mark a field as unique.
 *
 * @example
 * email: unique(z.string().email())
 */
export function unique<T extends ZodTypeAny>(schema: T): FieldWrapper<T> {
	return createWrapper(schema, {unique: true});
}

/**
 * Mark a field for indexing.
 *
 * @example
 * createdAt: index(z.date())
 */
export function index<T extends ZodTypeAny>(schema: T): FieldWrapper<T> {
	return createWrapper(schema, {indexed: true});
}

/**
 * Define a foreign key reference.
 *
 * @example
 * authorId: references(z.string().uuid(), users, { as: "author" })
 * authorId: references(z.string().uuid(), users, { field: "id", as: "author" })
 */
export function references<T extends ZodTypeAny>(
	schema: T,
	table: Table<any>,
	options: {
		field?: string;
		as: string;
		onDelete?: "cascade" | "set null" | "restrict";
	},
): FieldWrapper<T> {
	return createWrapper(schema, {
		reference: {
			table,
			field: options.field,
			as: options.as,
			onDelete: options.onDelete,
		},
	});
}

// ============================================================================
// Field Metadata Types (for forms/admin)
// ============================================================================

export type FieldType =
	| "text"
	| "textarea"
	| "email"
	| "url"
	| "tel"
	| "password"
	| "number"
	| "integer"
	| "checkbox"
	| "select"
	| "date"
	| "datetime"
	| "time"
	| "json"
	| "hidden";

export interface FieldMeta {
	name: string;
	type: FieldType;
	required: boolean;
	primaryKey?: boolean;
	unique?: boolean;
	indexed?: boolean;
	default?: unknown;
	maxLength?: number;
	minLength?: number;
	min?: number;
	max?: number;
	options?: readonly string[];
	reference?: {
		table: string;
		field: string;
		as: string;
	};
}

// ============================================================================
// Table
// ============================================================================

export interface TableOptions {
	indexes?: string[][];
}

export interface ReferenceInfo {
	fieldName: string;
	table: Table<any>;
	referencedField: string;
	as: string;
	onDelete?: "cascade" | "set null" | "restrict";
}

export interface Table<T extends ZodRawShape = ZodRawShape> {
	readonly name: string;
	readonly schema: ZodObject<T>;
	readonly indexes: string[][];

	// Pre-extracted metadata (no Zod walking needed)
	readonly _meta: {
		primary: string | null;
		unique: string[];
		indexed: string[];
		references: ReferenceInfo[];
		fields: Record<string, FieldDbMeta>;
	};

	/** Get field metadata for forms/admin */
	fields(): Record<string, FieldMeta>;

	/** Get primary key field name */
	primaryKey(): string | null;

	/** Get all foreign key references */
	references(): ReferenceInfo[];
}

type TableShape<T> = {
	[K in keyof T]: T[K] extends FieldWrapper<infer S> ? S : T[K];
};

/**
 * Define a database table with a Zod schema.
 *
 * @example
 * const users = table("users", {
 *   id: primary(z.string().uuid()),
 *   email: unique(z.string().email()),
 *   name: z.string().max(100),
 *   role: z.enum(["user", "admin"]).default("user"),
 * });
 */
export function table<T extends Record<string, ZodTypeAny | FieldWrapper>>(
	name: string,
	shape: T,
	options: TableOptions = {},
): Table<any> {
	// Extract Zod schemas and metadata
	const zodShape: Record<string, ZodTypeAny> = {};
	const meta = {
		primary: null as string | null,
		unique: [] as string[],
		indexed: [] as string[],
		references: [] as ReferenceInfo[],
		fields: {} as Record<string, FieldDbMeta>,
	};

	for (const [key, value] of Object.entries(shape)) {
		if (isFieldWrapper(value)) {
			zodShape[key] = value.schema;
			meta.fields[key] = value.meta;

			if (value.meta.primaryKey) {
				meta.primary = key;
			}
			if (value.meta.unique) {
				meta.unique.push(key);
			}
			if (value.meta.indexed) {
				meta.indexed.push(key);
			}
			if (value.meta.reference) {
				const ref = value.meta.reference;
				meta.references.push({
					fieldName: key,
					table: ref.table,
					referencedField: ref.field ?? ref.table.primaryKey() ?? "id",
					as: ref.as,
					onDelete: ref.onDelete,
				});
			}
		} else {
			zodShape[key] = value as ZodTypeAny;
		}
	}

	const schema = z.object(zodShape as any);

	return {
		name,
		schema,
		indexes: options.indexes ?? [],
		_meta: meta,

		fields(): Record<string, FieldMeta> {
			const result: Record<string, FieldMeta> = {};

			for (const [key, zodType] of Object.entries(zodShape)) {
				const dbMeta = meta.fields[key] || {};
				result[key] = extractFieldMeta(key, zodType, dbMeta);
			}

			return result;
		},

		primaryKey(): string | null {
			return meta.primary;
		},

		references(): ReferenceInfo[] {
			return meta.references;
		},
	};
}

// ============================================================================
// Field Metadata Extraction (from Zod types)
// ============================================================================

function unwrapType(zodType: ZodTypeAny): {
	core: ZodTypeAny;
	isOptional: boolean;
	isNullable: boolean;
	defaultValue?: unknown;
} {
	let core = zodType;
	let isOptional = false;
	let isNullable = false;
	let defaultValue: unknown = undefined;

	while (true) {
		const typeName = core._def.typeName;

		if (typeName === "ZodOptional") {
			isOptional = true;
			core = core._def.innerType;
		} else if (typeName === "ZodNullable") {
			isNullable = true;
			core = core._def.innerType;
		} else if (typeName === "ZodDefault") {
			defaultValue = core._def.defaultValue();
			core = core._def.innerType;
		} else if (typeName === "ZodEffects") {
			core = core._def.schema;
		} else if (typeName === "ZodPipeline") {
			core = core._def.in;
		} else if (typeName === "ZodBranded") {
			core = core._def.type;
		} else {
			break;
		}
	}

	return {core, isOptional, isNullable, defaultValue};
}

function extractFieldMeta(
	name: string,
	zodType: ZodTypeAny,
	dbMeta: FieldDbMeta,
): FieldMeta {
	const {core, isOptional, isNullable, defaultValue} = unwrapType(zodType);
	const typeName = core._def.typeName;

	const meta: FieldMeta = {
		name,
		type: "text",
		required: !isOptional && !isNullable && defaultValue === undefined,
	};

	// Apply database metadata
	if (dbMeta.primaryKey) meta.primaryKey = true;
	if (dbMeta.unique) meta.unique = true;
	if (dbMeta.indexed) meta.indexed = true;
	if (dbMeta.reference) {
		meta.reference = {
			table: dbMeta.reference.table.name,
			field: dbMeta.reference.field ?? dbMeta.reference.table.primaryKey() ?? "id",
			as: dbMeta.reference.as,
		};
	}

	if (defaultValue !== undefined) {
		meta.default = defaultValue;
	}

	// Determine field type from Zod
	switch (typeName) {
		case "ZodString": {
			const checks = core._def.checks || [];
			meta.type = "text";

			for (const check of checks) {
				if (check.kind === "email") {
					meta.type = "email";
				} else if (check.kind === "url") {
					meta.type = "url";
				} else if (check.kind === "max") {
					meta.maxLength = check.value;
					if (check.value > 500) {
						meta.type = "textarea";
					}
				} else if (check.kind === "min") {
					meta.minLength = check.value;
				}
			}
			break;
		}

		case "ZodNumber": {
			const checks = core._def.checks || [];
			meta.type = "number";

			for (const check of checks) {
				if (check.kind === "int") {
					meta.type = "integer";
				} else if (check.kind === "min") {
					meta.min = check.value;
				} else if (check.kind === "max") {
					meta.max = check.value;
				}
			}
			break;
		}

		case "ZodBoolean":
			meta.type = "checkbox";
			break;

		case "ZodDate":
			meta.type = "datetime";
			break;

		case "ZodEnum":
			meta.type = "select";
			meta.options = core._def.values;
			break;

		case "ZodArray":
		case "ZodObject":
			meta.type = "json";
			break;

		default:
			meta.type = "text";
	}

	return meta;
}

// ============================================================================
// Type Inference
// ============================================================================

/**
 * Infer the TypeScript type from a table (full document after read).
 */
export type Infer<T extends Table<any>> = z.infer<T["schema"]>;

/**
 * Infer the insert type (respects defaults).
 */
export type Insert<T extends Table<any>> = z.input<T["schema"]>;

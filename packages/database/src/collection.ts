/**
 * Collection definition and field extensions.
 *
 * A collection wraps a Zod schema with table metadata and provides
 * methods for extracting field information for forms/admin.
 */

import {z, ZodTypeAny, ZodObject, ZodRawShape} from "zod";

// ============================================================================
// Metadata Symbol
// ============================================================================

/**
 * Symbol used to attach database metadata to Zod schemas.
 */
const DB_META = Symbol.for("@b9g/database:meta");

export interface FieldDbMeta {
	primaryKey?: boolean;
	unique?: boolean;
	indexed?: boolean;
	reference?: {
		collection: Collection<any>;
		field: string;
		as: string;  // Property name for resolved entity (REQUIRED)
		onDelete?: "cascade" | "set null" | "restrict";
	};
	stored?: boolean;
	readTransform?: (val: any) => any;
}

function getMeta(schema: ZodTypeAny): FieldDbMeta | undefined {
	return (schema as any)[DB_META];
}

function setMeta(schema: ZodTypeAny, meta: FieldDbMeta): void {
	(schema as any)[DB_META] = meta;
}

function withMeta<T extends ZodTypeAny>(schema: T, meta: Partial<FieldDbMeta>): T {
	const existing = getMeta(schema) || {};
	setMeta(schema, {...existing, ...meta});
	return schema;
}

// ============================================================================
// Field Extensions (via .pipe())
// ============================================================================

/**
 * Marker for primary key fields.
 * @example z.string().uuid().pipe(primary())
 */
export function primary<T extends ZodTypeAny>(schema?: T) {
	const base = schema ?? z.any();
	const result = base.transform((val) => val);
	return withMeta(result, {primaryKey: true}) as unknown as T extends undefined
		? ReturnType<typeof z.any>
		: T;
}

/**
 * Marker for unique constraint.
 * @example z.string().email().pipe(unique())
 */
export function unique<T extends ZodTypeAny>(schema?: T) {
	const base = schema ?? z.any();
	const result = base.transform((val) => val);
	return withMeta(result, {unique: true}) as unknown as T extends undefined
		? ReturnType<typeof z.any>
		: T;
}

/**
 * Marker for indexed fields.
 * @example z.string().pipe(index())
 */
export function index<T extends ZodTypeAny>(schema?: T) {
	const base = schema ?? z.any();
	const result = base.transform((val) => val);
	return withMeta(result, {indexed: true}) as unknown as T extends undefined
		? ReturnType<typeof z.any>
		: T;
}

/**
 * Foreign key reference.
 * @example z.string().uuid().pipe(references(User, "id", "author"))
 */
export function references<T extends Collection<any>>(
	collection: T,
	field: string,
	as: string,
	options?: {onDelete?: "cascade" | "set null" | "restrict"},
) {
	const result = z.any().transform((val) => val);
	return withMeta(result, {
		reference: {collection, field, as, ...options},
	});
}

/**
 * Marks a transform that runs on read (from database).
 * The preceding transform runs on write (to database).
 *
 * @example
 * z.string()
 *   .transform(hash)           // write: plaintext → hash
 *   .pipe(stored(verify))      // read: hash → verified
 */
export function stored<TIn, TOut>(readTransform: (val: TIn) => TOut) {
	const result = z.any().transform(readTransform);
	return withMeta(result, {stored: true, readTransform});
}

// ============================================================================
// Field Metadata Types
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
	options?: readonly string[];  // for enums/select
	reference?: {
		collection: string;
		field: string;
	};
}

// ============================================================================
// Collection
// ============================================================================

export interface CollectionOptions {
	/**
	 * Collection version for migrations.
	 */
	version?: number;

	/**
	 * Compound indexes.
	 * @example indexes: [['email'], ['role', 'createdAt']]
	 */
	indexes?: string[][];
}

export interface ReferenceInfo {
	/** Field name in this collection (e.g., "authorId") */
	fieldName: string;
	/** Referenced collection */
	collection: Collection<any>;
	/** Field in referenced collection (e.g., "id") */
	referencedField: string;
	/** Property name for resolved entity (e.g., "author") */
	as: string;
	/** Delete behavior */
	onDelete?: "cascade" | "set null" | "restrict";
}

export interface Collection<T extends ZodRawShape> {
	/**
	 * Table name in the database.
	 */
	readonly name: string;

	/**
	 * The underlying Zod schema.
	 */
	readonly schema: ZodObject<T>;

	/**
	 * Collection version (for migrations).
	 */
	readonly version: number;

	/**
	 * Compound indexes.
	 */
	readonly indexes: string[][];

	/**
	 * Extract field metadata for forms/admin.
	 */
	fields(): Record<string, FieldMeta>;

	/**
	 * Get the primary key field name(s).
	 */
	primaryKey(): string | string[] | null;

	/**
	 * Get all foreign key references in this collection.
	 */
	references(): ReferenceInfo[];
}

/**
 * Define a collection (table) with a Zod schema.
 *
 * @example
 * const User = collection('users', {
 *   id: z.string().uuid().pipe(primary()),
 *   email: z.string().email().pipe(unique()),
 *   name: z.string().max(100),
 *   role: z.enum(['user', 'admin']).default('user'),
 *   createdAt: z.date().default(() => new Date()),
 * })
 */
export function collection<T extends ZodRawShape>(
	name: string,
	shape: T,
	options: CollectionOptions = {},
): Collection<T> {
	const schema = z.object(shape);

	return {
		name,
		schema,
		version: options.version ?? 1,
		indexes: options.indexes ?? [],

		fields(): Record<string, FieldMeta> {
			const result: Record<string, FieldMeta> = {};

			for (const [key, zodType] of Object.entries(shape)) {
				result[key] = extractFieldMeta(key, zodType as ZodTypeAny);
			}

			return result;
		},

		primaryKey(): string | string[] | null {
			const pks: string[] = [];

			for (const [key, zodType] of Object.entries(shape)) {
				if (isPrimaryKey(zodType as ZodTypeAny)) {
					pks.push(key);
				}
			}

			if (pks.length === 0) return null;
			if (pks.length === 1) return pks[0];
			return pks;
		},

		references(): ReferenceInfo[] {
			const refs: ReferenceInfo[] = [];

			for (const [key, zodType] of Object.entries(shape)) {
				const meta = collectMeta(zodType as ZodTypeAny);
				if (meta.reference) {
					refs.push({
						fieldName: key,
						collection: meta.reference.collection,
						referencedField: meta.reference.field,
						as: meta.reference.as,
						onDelete: meta.reference.onDelete,
					});
				}
			}

			return refs;
		},
	};
}

// ============================================================================
// Field Metadata Extraction
// ============================================================================

/**
 * Walk the Zod type chain and collect all metadata.
 */
export function collectMeta(zodType: ZodTypeAny): FieldDbMeta {
	const result: FieldDbMeta = {};

	function walk(type: ZodTypeAny): void {
		// Check for metadata on this type
		const meta = getMeta(type);
		if (meta) {
			Object.assign(result, meta);
		}

		const typeName = type._def.typeName;

		// Walk through wrapper types
		if (typeName === "ZodPipeline") {
			walk((type as any)._def.in);
			walk((type as any)._def.out);
		} else if (typeName === "ZodEffects") {
			walk((type as any)._def.schema);
		} else if (typeName === "ZodOptional" || typeName === "ZodNullable") {
			walk((type as any)._def.innerType);
		} else if (typeName === "ZodDefault") {
			walk((type as any)._def.innerType);
		} else if (typeName === "ZodBranded") {
			walk((type as any)._def.type);
		}
	}

	walk(zodType);
	return result;
}

/**
 * Check if a Zod type is marked as primary key.
 */
function isPrimaryKey(zodType: ZodTypeAny): boolean {
	return collectMeta(zodType).primaryKey === true;
}

/**
 * Check if a Zod type has a unique constraint.
 */
function isUnique(zodType: ZodTypeAny): boolean {
	return collectMeta(zodType).unique === true;
}

/**
 * Check if a Zod type is indexed.
 */
function isIndexed(zodType: ZodTypeAny): boolean {
	return collectMeta(zodType).indexed === true;
}

/**
 * Unwrap optional/nullable/default/effects to get the core type.
 */
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

	// Keep unwrapping until we hit a concrete type
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
			// Transform - unwrap to schema
			core = core._def.schema;
		} else if (typeName === "ZodPipeline") {
			// Pipeline - use input type for field detection
			core = core._def.in;
		} else if (typeName === "ZodBranded") {
			// Branded - unwrap
			core = core._def.type;
		} else {
			break;
		}
	}

	return {core, isOptional, isNullable, defaultValue};
}

/**
 * Extract field metadata from a Zod type.
 */
function extractFieldMeta(name: string, zodType: ZodTypeAny): FieldMeta {
	const {core, isOptional, isNullable, defaultValue} = unwrapType(zodType);
	const typeName = core._def.typeName;

	const meta: FieldMeta = {
		name,
		type: "text",
		required: !isOptional && !isNullable && defaultValue === undefined,
	};

	// Check constraints
	if (isPrimaryKey(zodType)) {
		meta.primaryKey = true;
	}
	if (isUnique(zodType)) {
		meta.unique = true;
	}
	if (isIndexed(zodType)) {
		meta.indexed = true;
	}

	// Set default
	if (defaultValue !== undefined) {
		meta.default = defaultValue;
	}

	// Determine field type based on Zod type
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
					// Heuristic: long max length suggests textarea
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
 * Infer the TypeScript type from a collection (full document after read).
 */
export type Infer<T extends Collection<any>> = z.infer<T["schema"]>;

/**
 * Infer the insert type (before write transforms, respects defaults).
 */
export type Insert<T extends Collection<any>> = z.input<T["schema"]>;

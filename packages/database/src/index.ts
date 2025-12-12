/**
 * @b9g/database - Schema-driven database client
 *
 * Zod schemas define storage, validation, and form fields.
 * Not an ORM - a thin wrapper over SQL.
 */

export {
	// Collection definition
	collection,
	type Collection,
	type CollectionOptions,
	type ReferenceInfo,

	// Field extensions
	primary,
	unique,
	index,
	references,
	stored,

	// Field metadata
	type FieldMeta,
	type FieldType,
	type FieldDbMeta,
	collectMeta,

	// Type inference
	type Infer,
	type Insert,
} from "./collection.js";

export {
	// DDL generation
	generateDDL,
	ddl,
	type DDLOptions,
} from "./ddl.js";

export {
	// Query building
	buildSelectColumns,
	parseTemplate,
	buildQuery,
	createQuery,
	rawQuery,
	createRawQuery,
	type SQLDialect,
	type QueryOptions,
	type ParsedQuery,
} from "./query.js";

export {
	// Normalization
	normalize,
	normalizeOne,
	extractEntityData,
	buildEntityMap,
	resolveReferences,
	getPrimaryKeyValue,
	entityKey,
	type RawRow,
	type EntityMap,
	type CollectionMap,
} from "./normalize.js";

export {
	// Database wrapper
	Database,
	createDatabase,
	type DatabaseDriver,
	type DatabaseOptions,
	type TaggedQuery,
} from "./database.js";

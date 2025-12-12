/**
 * @b9g/database - Schema-driven database client
 *
 * Zod schemas define storage, validation, and form fields.
 * Not an ORM - a thin wrapper over SQL.
 */

export {
	// Table definition
	table,
	type Table,
	type TableOptions,
	type ReferenceInfo,

	// Field wrappers
	primary,
	unique,
	index,
	references,

	// Field metadata
	type FieldMeta,
	type FieldType,
	type FieldDbMeta,

	// Type inference
	type Infer,
	type Insert,
} from "./table.js";

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
	// SQL fragments
	isSQLFragment,
	createFragment,
	type SQLFragment,
} from "./query.js";

export {
	// Fragment helpers
	where,
	set,
	on,
	type ConditionOperators,
	type ConditionValue,
	type WhereConditions,
	type SetValues,
} from "./fragments.js";

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
	type TableMap,
} from "./normalize.js";

export {
	// Database wrapper
	Database,
	Transaction,
	DatabaseUpgradeEvent,
	createDatabase,
	type DatabaseAdapter,
	type DatabaseDriver,
	type TransactionDriver,
	type DatabaseOptions,
	type TaggedQuery,
} from "./database.js";

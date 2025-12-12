/**
 * Entity normalization - Apollo-style entity deduplication with reference resolution.
 *
 * Takes raw SQL results with prefixed columns and returns normalized entities
 * with references resolved to actual object instances.
 */

import type {Table, ReferenceInfo} from "./table.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Raw row from SQL query with prefixed column names.
 * @example { "posts.id": "p1", "posts.authorId": "u1", "users.id": "u1", "users.name": "Alice" }
 */
export type RawRow = Record<string, unknown>;

/**
 * Entity map keyed by "table:primaryKey"
 */
export type EntityMap = Map<string, Record<string, unknown>>;

/**
 * Table map by table name for lookup
 */
export type TableMap = Map<string, Table<any>>;

// ============================================================================
// Parsing
// ============================================================================

/**
 * Extract entity data from a raw row for a specific table.
 *
 * @example
 * extractEntityData({ "posts.id": "p1", "users.id": "u1" }, "posts")
 * // { id: "p1" }
 */
export function extractEntityData(
	row: RawRow,
	tableName: string,
): Record<string, unknown> | null {
	const prefix = `${tableName}.`;
	const entity: Record<string, unknown> = {};
	let hasData = false;

	for (const [key, value] of Object.entries(row)) {
		if (key.startsWith(prefix)) {
			const fieldName = key.slice(prefix.length);
			entity[fieldName] = value;
			if (value !== null && value !== undefined) {
				hasData = true;
			}
		}
	}

	return hasData ? entity : null;
}

/**
 * Get the primary key value for an entity.
 */
export function getPrimaryKeyValue(
	entity: Record<string, unknown>,
	table: Table<any>,
): string | null {
	const pk = table.primaryKey();

	if (pk === null) {
		return null;
	}

	const value = entity[pk];
	return value !== null && value !== undefined ? String(value) : null;
}

/**
 * Create entity key for the entity map.
 */
export function entityKey(tableName: string, primaryKey: string): string {
	return `${tableName}:${primaryKey}`;
}

// ============================================================================
// Normalization
// ============================================================================

/**
 * Build an entity map from raw rows.
 *
 * Entities are deduplicated - same primary key = same object instance.
 */
export function buildEntityMap(
	rows: RawRow[],
	tables: Table<any>[],
): EntityMap {
	const entities: EntityMap = new Map();

	for (const row of rows) {
		for (const table of tables) {
			const data = extractEntityData(row, table.name);
			if (!data) continue;

			const pk = getPrimaryKeyValue(data, table);
			if (!pk) continue;

			const key = entityKey(table.name, pk);

			if (!entities.has(key)) {
				entities.set(key, data);
			}
		}
	}

	return entities;
}

/**
 * Resolve references for all entities in the map.
 *
 * Walks each table's references() and adds resolved entities as properties.
 */
export function resolveReferences(
	entities: EntityMap,
	tables: Table<any>[],
): void {
	for (const table of tables) {
		const refs = table.references();
		if (refs.length === 0) continue;

		const prefix = `${table.name}:`;

		for (const [key, entity] of entities) {
			if (!key.startsWith(prefix)) continue;

			for (const ref of refs) {
				const foreignKeyValue = entity[ref.fieldName];
				if (foreignKeyValue === null || foreignKeyValue === undefined) {
					entity[ref.as] = null;
					continue;
				}

				const refKey = entityKey(ref.table.name, String(foreignKeyValue));
				const refEntity = entities.get(refKey);

				entity[ref.as] = refEntity ?? null;
			}
		}
	}
}

/**
 * Extract main table entities from the entity map in row order.
 *
 * Maintains the order from the original query results.
 */
export function extractMainEntities<T>(
	rows: RawRow[],
	mainTable: Table<any>,
	entities: EntityMap,
): T[] {
	const results: T[] = [];
	const seen = new Set<string>();

	for (const row of rows) {
		const data = extractEntityData(row, mainTable.name);
		if (!data) continue;

		const pk = getPrimaryKeyValue(data, mainTable);
		if (!pk) continue;

		const key = entityKey(mainTable.name, pk);

		if (seen.has(key)) continue;
		seen.add(key);

		const entity = entities.get(key);
		if (entity) {
			results.push(entity as T);
		}
	}

	return results;
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Normalize raw SQL rows into deduplicated entities with resolved references.
 *
 * @example
 * const rows = [
 *   { "posts.id": "p1", "posts.authorId": "u1", "users.id": "u1", "users.name": "Alice" },
 *   { "posts.id": "p2", "posts.authorId": "u1", "users.id": "u1", "users.name": "Alice" },
 * ];
 *
 * const posts = normalize(rows, [posts, users]);
 * // posts[0].author === posts[1].author  // Same instance!
 */
export function normalize<T>(
	rows: RawRow[],
	tables: Table<any>[],
): T[] {
	if (tables.length === 0) {
		throw new Error("At least one table is required");
	}

	if (rows.length === 0) {
		return [];
	}

	const entities = buildEntityMap(rows, tables);
	resolveReferences(entities, tables);

	const mainTable = tables[0];
	return extractMainEntities<T>(rows, mainTable, entities);
}

/**
 * Normalize a single row into an entity.
 *
 * Returns null if the main table has no data (e.g., no match).
 */
export function normalizeOne<T>(
	row: RawRow | null,
	tables: Table<any>[],
): T | null {
	if (!row) return null;

	const results = normalize<T>([row], tables);
	return results[0] ?? null;
}

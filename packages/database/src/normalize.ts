/**
 * Entity normalization - Apollo-style entity deduplication with reference resolution.
 *
 * Takes raw SQL results with prefixed columns and returns normalized entities
 * with references resolved to actual object instances.
 */

import type {Collection, ReferenceInfo} from "./collection.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Raw row from SQL query with prefixed column names.
 * @example { "posts.id": "p1", "posts.authorId": "u1", "users.id": "u1", "users.name": "Alice" }
 */
export type RawRow = Record<string, unknown>;

/**
 * Entity map keyed by "collection:primaryKey"
 */
export type EntityMap = Map<string, Record<string, unknown>>;

/**
 * Collection map by table name for lookup
 */
export type CollectionMap = Map<string, Collection<any>>;

// ============================================================================
// Parsing
// ============================================================================

/**
 * Extract entity data from a raw row for a specific collection.
 *
 * @example
 * extractEntityData({ "posts.id": "p1", "users.id": "u1" }, "posts")
 * // { id: "p1" }
 */
export function extractEntityData(
	row: RawRow,
	collectionName: string,
): Record<string, unknown> | null {
	const prefix = `${collectionName}.`;
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

	// Return null if all values are null (LEFT JOIN with no match)
	return hasData ? entity : null;
}

/**
 * Get the primary key value for an entity.
 */
export function getPrimaryKeyValue(
	entity: Record<string, unknown>,
	collection: Collection<any>,
): string | null {
	const pk = collection.primaryKey();

	if (pk === null) {
		return null;
	}

	if (Array.isArray(pk)) {
		// Composite key - join values
		const values = pk.map((k) => String(entity[k] ?? ""));
		return values.join(":");
	}

	const value = entity[pk];
	return value !== null && value !== undefined ? String(value) : null;
}

/**
 * Create entity key for the entity map.
 */
export function entityKey(collectionName: string, primaryKey: string): string {
	return `${collectionName}:${primaryKey}`;
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
	collections: Collection<any>[],
): EntityMap {
	const entities: EntityMap = new Map();
	const collectionMap = new Map(collections.map((c) => [c.name, c]));

	for (const row of rows) {
		for (const collection of collections) {
			const data = extractEntityData(row, collection.name);
			if (!data) continue;

			const pk = getPrimaryKeyValue(data, collection);
			if (!pk) continue;

			const key = entityKey(collection.name, pk);

			// Only add if not already present (deduplication)
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
 * Walks each collection's references() and adds resolved entities as properties.
 */
export function resolveReferences(
	entities: EntityMap,
	collections: Collection<any>[],
): void {
	const collectionMap = new Map(collections.map((c) => [c.name, c]));

	for (const collection of collections) {
		const refs = collection.references();
		if (refs.length === 0) continue;

		// Find all entities of this collection
		const prefix = `${collection.name}:`;

		for (const [key, entity] of entities) {
			if (!key.startsWith(prefix)) continue;

			// Resolve each reference
			for (const ref of refs) {
				const foreignKeyValue = entity[ref.fieldName];
				if (foreignKeyValue === null || foreignKeyValue === undefined) {
					// Null reference - set property to null
					entity[ref.as] = null;
					continue;
				}

				// Look up the referenced entity
				const refKey = entityKey(ref.collection.name, String(foreignKeyValue));
				const refEntity = entities.get(refKey);

				// Set the resolved entity (or null if not found)
				entity[ref.as] = refEntity ?? null;
			}
		}
	}
}

/**
 * Extract main collection entities from the entity map in row order.
 *
 * Maintains the order from the original query results.
 */
export function extractMainEntities<T>(
	rows: RawRow[],
	mainCollection: Collection<any>,
	entities: EntityMap,
): T[] {
	const results: T[] = [];
	const seen = new Set<string>();

	for (const row of rows) {
		const data = extractEntityData(row, mainCollection.name);
		if (!data) continue;

		const pk = getPrimaryKeyValue(data, mainCollection);
		if (!pk) continue;

		const key = entityKey(mainCollection.name, pk);

		// Skip duplicates but maintain order
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
 * const posts = normalize(rows, [Post, User]);
 * // posts[0].author === posts[1].author  // Same instance!
 */
export function normalize<T>(
	rows: RawRow[],
	collections: Collection<any>[],
): T[] {
	if (collections.length === 0) {
		throw new Error("At least one collection is required");
	}

	if (rows.length === 0) {
		return [];
	}

	// Build entity map (deduplicates entities)
	const entities = buildEntityMap(rows, collections);

	// Resolve all references
	resolveReferences(entities, collections);

	// Extract main collection entities in original order
	const mainCollection = collections[0];
	return extractMainEntities<T>(rows, mainCollection, entities);
}

/**
 * Normalize a single row into an entity.
 *
 * Returns null if the main collection has no data (e.g., no match).
 */
export function normalizeOne<T>(
	row: RawRow | null,
	collections: Collection<any>[],
): T | null {
	if (!row) return null;

	const results = normalize<T>([row], collections);
	return results[0] ?? null;
}

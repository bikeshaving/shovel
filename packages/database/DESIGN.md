# @b9g/database Design Document

## Overview

A schema-driven SQL client for TypeScript. Not an ORM — a thin wrapper over SQL that uses Zod schemas to define storage, validation, and form metadata in one place.

## Design Philosophy

1. **Zod as the source of truth** — One schema defines SQL types, validation rules, and form field metadata
2. **SQL is not hidden** — You write SQL with tagged templates, we just help with parameterization and normalization
3. **IndexedDB-style migrations** — Event-based versioning (`upgradeneeded` event with `waitUntil()`)
4. **Apollo-style normalization** — Entities from JOINs are deduplicated and references resolve to object instances

## Core APIs

### Table Definition

```typescript
import {z} from "zod";
import {table, primary, unique, index, references} from "@b9g/database";

const users = table("users", {
  id: primary(z.string().uuid()),
  email: unique(z.string().email()),
  name: z.string().max(100),
  role: z.enum(["user", "admin"]).default("user"),
  createdAt: z.date().default(() => new Date()),
});

const posts = table("posts", {
  id: primary(z.string().uuid()),
  title: z.string(),
  content: z.string().optional(),
  authorId: references(z.string().uuid(), users, {as: "author", onDelete: "cascade"}),
  published: z.boolean().default(false),
});
```

**Field wrappers:**
- `primary(schema)` — Primary key
- `unique(schema)` — Unique constraint
- `index(schema)` — Create an index
- `references(schema, table, {as, field?, onDelete?})` — Foreign key with resolved property name

**Compound indexes** via table options:
```typescript
const posts = table("posts", {...}, {
  indexes: [["authorId", "createdAt"]]
});
```

### Database Class

Extends `EventTarget` for web-standard event handling:

```typescript
import {Database} from "@b9g/database";
import {createBunDriver} from "@b9g/database/bun-sql";

const {driver, close} = createBunDriver("postgres://localhost/mydb");
const db = new Database(driver, {dialect: "postgresql"});

// IndexedDB-style migrations
db.addEventListener("upgradeneeded", (e) => {
  e.waitUntil(async () => {
    if (e.oldVersion < 1) {
      await db.exec`${generateDDL(users)}`;
      await db.exec`${generateDDL(posts)}`;
    }
    if (e.oldVersion < 2) {
      await db.exec`ALTER TABLE users ADD COLUMN avatar TEXT`;
    }
  });
});

await db.open(2); // Opens at version 2, fires upgradeneeded if needed
```

### Query Methods

Tagged templates with parameterization:

```typescript
// Normalized queries — returns entities with resolved references
const posts = await db.all(posts, users)`
  JOIN users ON users.id = posts.author_id
  WHERE published = ${true}
`;
posts[0].author.name           // "Alice" — resolved from JOIN
posts[0].author === posts[1].author  // true — same instance (Apollo-style)

// Single entity
const post = await db.one(posts, users)`
  JOIN users ON users.id = posts.author_id
  WHERE posts.id = ${postId}
`;

// Raw queries (no normalization)
const counts = await db.query<{count: number}>`
  SELECT COUNT(*) as count FROM posts WHERE author_id = ${userId}
`;

// Execute statements
await db.exec`CREATE INDEX idx_posts_author ON posts(author_id)`;

// Single value
const count = await db.val<number>`SELECT COUNT(*) FROM posts`;
```

**CRUD helpers:**

```typescript
// Insert with Zod validation
const user = await db.insert(users, {
  id: crypto.randomUUID(),
  email: "alice@example.com",
  name: "Alice",
});

// Update by primary key
await db.update(users, userId, {name: "Bob"});

// Delete by primary key
await db.delete(users, userId);
```

### Transactions

```typescript
await db.transaction(async (tx) => {
  const user = await tx.insert(users, {...});
  await tx.insert(posts, {authorId: user.id, ...});
  // Commits on success, rollbacks on error
});

// Returns values
const user = await db.transaction(async (tx) => {
  return await tx.insert(users, {...});
});
```

### DDL Generation

Generate CREATE TABLE from Zod schemas:

```typescript
import {generateDDL} from "@b9g/database";

const ddl = generateDDL(users, {dialect: "postgresql"});
// CREATE TABLE IF NOT EXISTS "users" (
//   "id" TEXT NOT NULL PRIMARY KEY,
//   "email" TEXT NOT NULL UNIQUE,
//   "name" VARCHAR(100) NOT NULL,
//   "role" TEXT DEFAULT 'user',
//   "createdAt" TIMESTAMPTZ DEFAULT NOW()
// );
```

**Foreign key constraints** are generated automatically:

```typescript
const ddl = generateDDL(posts, {dialect: "postgresql"});
// ...
// FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE
```

**Dialect-specific features:**

| Feature | SQLite | PostgreSQL | MySQL |
|---------|--------|------------|-------|
| Date type | TEXT | TIMESTAMPTZ | DATETIME |
| Date default | CURRENT_TIMESTAMP | NOW() | CURRENT_TIMESTAMP |
| Boolean | INTEGER | BOOLEAN | BOOLEAN |
| JSON | TEXT | JSONB | TEXT |
| Quoting | "double" | "double" | \`backtick\` |

## Entity Normalization

The `all()`/`one()` methods:
1. Generate SELECT with prefixed column aliases (`posts.id AS "posts.id"`)
2. Parse rows into per-table entities
3. Deduplicate by primary key (same PK = same object instance)
4. Resolve `references()` to actual entity objects

```typescript
// Input rows from SQL:
[
  {"posts.id": "p1", "posts.authorId": "u1", "users.id": "u1", "users.name": "Alice"},
  {"posts.id": "p2", "posts.authorId": "u1", "users.id": "u1", "users.name": "Alice"},
]

// Output after normalization:
[
  {id: "p1", authorId: "u1", author: {id: "u1", name: "Alice"}},
  {id: "p2", authorId: "u1", author: /* same object as above */},
]
```

## Migration Safety

Multi-process safe migrations using exclusive locking:

| Dialect | Locking Strategy |
|---------|------------------|
| SQLite | `BEGIN IMMEDIATE` (write lock upfront) |
| PostgreSQL | `BEGIN` + `SELECT ... FOR UPDATE` |
| MySQL | `START TRANSACTION` + `SELECT ... FOR UPDATE` |

Version is re-checked inside the lock to prevent race conditions.

## Driver Interface

Adapters implement a simple interface:

```typescript
interface DatabaseDriver {
  all<T>(sql: string, params: unknown[]): Promise<T[]>;
  get<T>(sql: string, params: unknown[]): Promise<T | null>;
  run(sql: string, params: unknown[]): Promise<number>; // affected rows
  val<T>(sql: string, params: unknown[]): Promise<T>;   // single value
}

interface DatabaseAdapter {
  driver: DatabaseDriver;
  close(): Promise<void>;
}
```

The included `@b9g/database/bun-sql` adapter wraps Bun's built-in SQL which supports PostgreSQL, MySQL, and SQLite with zero dependencies.

## Type Inference

```typescript
type User = Infer<typeof users>;    // Full type (after read)
type NewUser = Insert<typeof users>; // Insert type (respects defaults)
```

## Field Metadata Extraction

Tables expose metadata for form generation:

```typescript
const fields = users.fields();
// {
//   email: { name: "email", type: "email", required: true, unique: true },
//   name: { name: "name", type: "text", required: true, maxLength: 100 },
//   role: { name: "role", type: "select", options: ["user", "admin"], default: "user" },
// }

const pk = users.primaryKey();   // "id"
const refs = users.references(); // [{fieldName: "authorId", table: users, as: "author", onDelete: "cascade"}]
```

## Key Design Decisions

### Why wrapper functions instead of .pipe()?

We originally used `.pipe()` to attach metadata, but switched to wrapper functions:

```typescript
// Before (pipe approach)
id: z.string().uuid().pipe(primary())

// After (wrapper approach)
id: primary(z.string().uuid())
```

Benefits:
- Simpler, more readable syntax
- No reliance on Zod's pipe internals
- Works seamlessly with Zod 4's stricter types
- Metadata extracted at table definition time (not during validation)

### Why Zod 4 with public APIs only?

We use only Zod's public APIs (`instanceof` checks, `isOptional()`, `isNullable()`, `removeDefault()`, `unwrap()`, etc.) — no `_def` access. This ensures compatibility across Zod versions.

### Why EventTarget for migrations?

- **Web standard** — same pattern as IndexedDB's `onupgradeneeded`
- **`waitUntil()` pattern** from ServiceWorker's `ExtendableEvent`
- **Forward-only migrations** (no down migrations)
- **Version stored in `_migrations` table**

### Why tagged templates for queries?

- SQL injection safe via parameterization
- No query builder abstractions
- Full SQL power — write JOINs, CTEs, window functions directly
- IDE syntax highlighting works

### Why Apollo-style normalization?

- N+1 JOINs return denormalized rows — normalization fixes this
- Same entity from multiple rows = same object instance
- References resolve automatically based on table definitions
- No additional queries needed for related data

## File Structure

```
packages/database/src/
├── table.ts      # table(), primary(), unique(), index(), references()
├── database.ts   # Database class with migrations + transactions
├── ddl.ts        # generateDDL() — Zod → CREATE TABLE + indexes + FKs
├── query.ts      # Tagged template parsing
├── normalize.ts  # Entity deduplication + reference resolution
├── bun-sql.ts    # Bun.SQL adapter
└── index.ts      # exports
```

## Status

### Implemented
- [x] Table definitions with wrapper functions
- [x] DDL generation (CREATE TABLE, indexes, foreign keys)
- [x] Query methods (all, one, query, exec, val)
- [x] CRUD helpers (insert, update, delete)
- [x] Entity normalization with reference resolution
- [x] IndexedDB-style migrations with `upgradeneeded` event
- [x] Multi-process migration safety (exclusive locking)
- [x] Transaction support with auto-commit/rollback
- [x] Zod 4 compatibility (public APIs only)

### Open Questions

1. **Relation loading** — Currently requires explicit JOINs. Should we add lazy loading or `include` syntax?
2. **Query builder** — Is raw SQL sufficient, or do we need type-safe query building for common cases?
3. **Connection pooling** — Current transaction API assumes single connection. Need to consider pooled connections.

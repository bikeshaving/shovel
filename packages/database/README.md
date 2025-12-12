# @b9g/database

A schema-driven SQL client for TypeScript. Replaces ORMs (Prisma, Drizzle ORM), query builders (Kysely), and raw client wrappers with a single SQL-first library built on Zod schemas and event-driven migrations.

**Not an ORM** — a thin wrapper over SQL that uses Zod schemas to define storage, validation, and metadata in one place.

## Design Principles

1. **Zod as the source of truth** — One schema defines SQL types, validation rules, and form field metadata
2. **SQL is not hidden** — You write SQL with tagged templates; we handle parameterization and normalization
3. **Schema-driven normalization** — Relationships are resolved from table definitions, not query shape
4. **No codegen** — All behavior is runtime-driven; no schema files, migrations folders, CLI generators, or compile-time artifacts

## Two Modes

The library operates in two distinct modes that remain separate:

**Structural mode**: Table definitions, DDL generation, metadata extraction. Define your schema once and derive everything from it.

**Operational mode**: Queries, normalization, transactions. Write SQL directly with full control.

This separation is intentional — the system is not an ORM because these modes never blur together.

## Installation

```bash
bun add @b9g/database zod
```

## Quick Start

```typescript
import {z} from "zod";
import {table, primary, unique, references, generateDDL, Database} from "@b9g/database";

// 1. Define tables
const Users = table("users", {
  id: primary(z.string().uuid()),
  email: unique(z.string().email()),
  name: z.string(),
});

const Posts = table("posts", {
  id: primary(z.string().uuid()),
  authorId: references(z.string().uuid(), Users, {as: "author"}),
  title: z.string(),
  published: z.boolean().default(false),
});

// 2. Create database with migrations
const db = new Database(driver, {dialect: "postgresql"});

db.addEventListener("upgradeneeded", (e) => {
  e.waitUntil((async () => {
    if (e.oldVersion < 1) {
      await db.exec`${generateDDL(Users)}`;
      await db.exec`${generateDDL(Posts)}`;
    }
    if (e.oldVersion < 2) {
      await db.exec`ALTER TABLE users ADD COLUMN avatar TEXT`;
    }
  })());
});

await db.open(2);

// 3. Insert with validation
const user = await db.insert(Users, {
  id: crypto.randomUUID(),
  email: "alice@example.com",
  name: "Alice",
});

// 4. Query with normalization
const posts = await db.all(Posts, Users)`
  JOIN users ON users.id = posts.author_id
  WHERE published = ${true}
`;

posts[0].author.name;              // "Alice" — resolved from JOIN
posts[0].author === posts[1].author; // true — same instance

// 5. Update
await db.update(Users, user.id, {name: "Alice Smith"});
```

## Table Definitions

```typescript
import {z} from "zod";
import {table, primary, unique, index, references} from "@b9g/database";

const Users = table("users", {
  id: primary(z.string().uuid()),
  email: unique(z.string().email()),
  name: z.string().max(100),
  role: z.enum(["user", "admin"]).default("user"),
  createdAt: z.date().default(() => new Date()),
});

const Posts = table("posts", {
  id: primary(z.string().uuid()),
  title: z.string(),
  content: z.string().optional(),
  authorId: references(z.string().uuid(), Users, {as: "author", onDelete: "cascade"}),
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
const Posts = table("posts", {...}, {
  indexes: [["authorId", "createdAt"]]
});
```

**Table identity**: A table definition is a singleton value. Importing it from multiple modules does not create duplicates — normalization and references rely on identity, not name.

## Queries

Tagged templates with automatic parameterization:

```typescript
// Normalized queries — entities with resolved references
const posts = await db.all(Posts, Users)`
  JOIN users ON users.id = posts.author_id
  WHERE published = ${true}
`;

// Single entity
const post = await db.one(Posts)`WHERE id = ${postId}`;

// Raw queries (no normalization)
const counts = await db.query<{count: number}>`
  SELECT COUNT(*) as count FROM posts WHERE author_id = ${userId}
`;

// Execute statements
await db.exec`CREATE INDEX idx_posts_author ON posts(author_id)`;

// Single value
const count = await db.val<number>`SELECT COUNT(*) FROM posts`;
```

## Fragment Helpers

Type-safe SQL fragments that compose inside tagged templates:

```typescript
import {where, set, on} from "@b9g/database";

// WHERE conditions with operator DSL
const posts = await db.all(Posts)`
  WHERE ${where(Posts, {published: true, viewCount: {$gte: 100}})}
`;
// → WHERE published = ? AND view_count >= ?

// UPDATE with set()
await db.exec`
  UPDATE posts
  SET ${set(Posts, {title: "New Title", updatedAt: new Date()})}
  WHERE id = ${postId}
`;
// → UPDATE posts SET title = ?, updated_at = ? WHERE id = ?

// JOIN with on()
const posts = await db.all(Posts, Users)`
  JOIN users ON ${on(Posts, "authorId")}
  WHERE published = ${true}
`;
// → JOIN users ON users.id = posts.author_id
```

**Operators:** `$eq`, `$neq`, `$lt`, `$gt`, `$lte`, `$gte`, `$like`, `$in`, `$isNull`

Operators are intentionally limited to simple, single-column predicates. `OR`, subqueries, and cross-table logic belong in raw SQL.

## CRUD Helpers

```typescript
// Insert with Zod validation
const user = await db.insert(Users, {
  id: crypto.randomUUID(),
  email: "alice@example.com",
  name: "Alice",
});

// Update by primary key
await db.update(Users, userId, {name: "Bob"});

// Delete by primary key
await db.delete(Users, userId);
```

## Transactions

```typescript
await db.transaction(async (tx) => {
  const user = await tx.insert(Users, {...});
  await tx.insert(Posts, {authorId: user.id, ...});
  // Commits on success, rollbacks on error
});

// Returns values
const user = await db.transaction(async (tx) => {
  return await tx.insert(Users, {...});
});
```

## Migrations

IndexedDB-style event-based migrations:

```typescript
db.addEventListener("upgradeneeded", (e) => {
  e.waitUntil((async () => {
    if (e.oldVersion < 1) {
      await db.exec`${generateDDL(Users)}`;
      await db.exec`${generateDDL(Posts)}`;
    }
    if (e.oldVersion < 2) {
      await db.exec`ALTER TABLE users ADD COLUMN avatar TEXT`;
    }
  })());
});

await db.open(2); // Opens at version 2, fires upgradeneeded if needed
```

**Migration rules:**
- Migrations run sequentially from `oldVersion + 1` to `newVersion`
- If a migration crashes, the version does not bump
- You must keep migration code around indefinitely (forward-only, no down migrations)
- Multi-process safe via exclusive locking

**Why EventTarget?** Web standard pattern (like IndexedDB's `onupgradeneeded`). Third-party code can subscribe to lifecycle events without changing constructor signatures, enabling plugins for logging, tracing, and instrumentation.

## DDL Generation

Generate CREATE TABLE from Zod schemas:

```typescript
import {generateDDL} from "@b9g/database";

const ddl = generateDDL(Users, {dialect: "postgresql"});
// CREATE TABLE IF NOT EXISTS "users" (
//   "id" TEXT NOT NULL PRIMARY KEY,
//   "email" TEXT NOT NULL UNIQUE,
//   "name" VARCHAR(100) NOT NULL,
//   "role" TEXT DEFAULT 'user',
//   "created_at" TIMESTAMPTZ DEFAULT NOW()
// );
```

Foreign key constraints are generated automatically:

```typescript
const ddl = generateDDL(Posts);
// FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE
```

**Dialect support:**

| Feature | SQLite | PostgreSQL | MySQL |
|---------|--------|------------|-------|
| Date type | TEXT | TIMESTAMPTZ | DATETIME |
| Date default | CURRENT_TIMESTAMP | NOW() | CURRENT_TIMESTAMP |
| Boolean | INTEGER | BOOLEAN | BOOLEAN |
| JSON | TEXT | JSONB | JSON |
| Quoting | "double" | "double" | \`backtick\` |

## Entity Normalization

Normalization is driven by table metadata, not query shape — SQL stays unrestricted.

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

## Type Inference

```typescript
type User = Infer<typeof Users>;     // Full type (after read)
type NewUser = Insert<typeof Users>; // Insert type (respects defaults)
```

## Field Metadata

Tables expose metadata for form generation:

```typescript
const fields = Users.fields();
// {
//   email: { name: "email", type: "email", required: true, unique: true },
//   name: { name: "name", type: "text", required: true, maxLength: 100 },
//   role: { name: "role", type: "select", options: ["user", "admin"], default: "user" },
// }

const pk = Users.primaryKey();   // "id"
const refs = Posts.references(); // [{fieldName: "authorId", table: Users, as: "author"}]
```

## Performance

- Tagged template queries are cached by template object identity (compiled once per call site)
- Normalization cost is O(rows) with hash maps per table
- Reference resolution is zero-cost after deduplication

## Driver Interface

Adapters implement a simple interface:

```typescript
interface DatabaseDriver {
  all<T>(sql: string, params: unknown[]): Promise<T[]>;
  get<T>(sql: string, params: unknown[]): Promise<T | null>;
  run(sql: string, params: unknown[]): Promise<number>; // affected rows
  val<T>(sql: string, params: unknown[]): Promise<T>;   // single value
}
```

## What This Library Does Not Do

- **No model classes** — Tables are plain definitions, not class instances
- **No hidden JOINs** — You write all SQL explicitly
- **No implicit query building** — No `.where().orderBy().limit()` chains
- **No lazy loading** — Related data comes from your JOINs
- **No compile-time migrations** — Runtime event-based only
- **No ORM identity map** — Normalization is per-query, not session-wide

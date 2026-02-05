# Databases

Shovel provides a SQL database API with versioned migrations, inspired by [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)'s upgrade pattern. Databases are available globally via `databases` in your ServiceWorker code.

## Quick Start

```typescript
// Open database with version and migration
addEventListener("activate", (event) => {
  event.waitUntil(
    databases.open("main", 1, (e) => {
      e.waitUntil(
        e.db.exec`
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL
          )
        `
      );
    })
  );
});

// Query the database
addEventListener("fetch", async (event) => {
  const db = databases.get("main");
  const users = await db.all`SELECT * FROM users`;
  event.respondWith(Response.json(users));
});
```

---

## Configuration

Configure databases in `shovel.json`:

```json
{
  "databases": {
    "main": {
      "module": "@b9g/zen/bun",
      "url": "sqlite://./data/app.db"
    }
  }
}
```

### Environment-Based Configuration

```json
{
  "databases": {
    "main": {
      "module": "$PLATFORM === bun ? @b9g/zen/bun : @b9g/zen/better-sqlite3",
      "url": "$DATABASE_URL || sqlite://./data/app.db"
    }
  }
}
```

### URL Formats

| Database | URL Format |
|----------|------------|
| SQLite | `sqlite://./path/to/db.sqlite` |
| PostgreSQL | `postgres://user:pass@host:5432/dbname` |

### Configuration Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `module` | `string` | Yes | Module path to import |
| `export` | `string` | No | Named export (default: `"default"`) |
| `url` | `string` | Yes | Database connection URL |

Additional fields are passed to the driver (e.g., `max`, `idleTimeout` for connection pooling).

---

## DatabaseStorage API

The global `databases` object provides:

### databases.open(name, version, onUpgrade?)

Opens a database with versioned migrations.

```typescript
await databases.open("main", 1, (event) => {
  // Run migrations
});
```

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Database name from config |
| `version` | `number` | Target schema version |
| `onUpgrade` | `function` | Migration callback |

### databases.get(name)

Gets a previously opened database (synchronous).

```typescript
const db = databases.get("main");
```

**Throws** if the database hasn't been opened yet.

### databases.close(name)

Closes a database connection.

```typescript
await databases.close("main");
```

### databases.closeAll()

Closes all database connections.

```typescript
await databases.closeAll();
```

---

## Migrations

The `onUpgrade` callback runs when the database version changes:

```typescript
databases.open("main", 3, (event) => {
  event.waitUntil(
    (async () => {
      const db = event.db;

      if (event.oldVersion < 1) {
        await db.exec`
          CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL
          )
        `;
      }

      if (event.oldVersion < 2) {
        await db.exec`
          ALTER TABLE users ADD COLUMN email TEXT
        `;
      }

      if (event.oldVersion < 3) {
        await db.exec`
          CREATE INDEX idx_users_email ON users(email)
        `;
      }
    })()
  );
});
```

### Upgrade Event

| Property | Type | Description |
|----------|------|-------------|
| `db` | `Database` | Database instance |
| `oldVersion` | `number` | Previous version (0 for new) |
| `newVersion` | `number` | Target version |
| `waitUntil(promise)` | `function` | Wait for migration to complete |

### Best Practices

1. **Incremental migrations**: Check `oldVersion` for each migration step
2. **Use `waitUntil`**: Ensures migrations complete before activation
3. **Idempotent operations**: Use `IF NOT EXISTS` where possible
4. **Version numbers**: Always increment, never reuse

---

## Database API

The database instance provides SQL operations using tagged templates:

### db.exec\`sql\`

Executes SQL without returning results.

```typescript
await db.exec`
  INSERT INTO users (name, email)
  VALUES (${"Alice"}, ${"alice@example.com"})
`;

await db.exec`DROP TABLE IF EXISTS old_table`;
```

### db.all\`sql\`

Returns all matching rows.

```typescript
const users = await db.all<User>`
  SELECT * FROM users WHERE active = ${true}
`;
// [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]
```

### db.get\`sql\`

Returns the first matching row or undefined.

```typescript
const user = await db.get<User>`
  SELECT * FROM users WHERE id = ${userId}
`;
if (user) {
  console.log(user.name);
}
```

### db.query\`sql\`

Alias for `all`. Returns all matching rows.

```typescript
const posts = await db.query<Post>`
  SELECT * FROM posts WHERE author_id = ${userId}
`;
```

---

## Type Safety

Use TypeScript interfaces for type-safe queries:

```typescript
interface User {
  id: number;
  name: string;
  email: string;
  created_at: string;
}

interface Post {
  id: number;
  user_id: number;
  title: string;
  body: string;
}

// Typed results
const user = await db.get<User>`
  SELECT * FROM users WHERE id = ${1}
`;
// user is User | undefined

const posts = await db.all<Post>`
  SELECT * FROM posts
`;
// posts is Post[]
```

---

## Common Patterns

### CRUD Operations

```typescript
// Create
await db.exec`
  INSERT INTO users (name, email)
  VALUES (${name}, ${email})
`;

// Read
const user = await db.get<User>`
  SELECT * FROM users WHERE id = ${id}
`;

// Update
await db.exec`
  UPDATE users SET name = ${newName} WHERE id = ${id}
`;

// Delete
await db.exec`
  DELETE FROM users WHERE id = ${id}
`;
```

### Transactions

```typescript
await db.exec`BEGIN TRANSACTION`;
try {
  await db.exec`INSERT INTO orders (user_id) VALUES (${userId})`;
  await db.exec`UPDATE inventory SET count = count - 1 WHERE id = ${itemId}`;
  await db.exec`COMMIT`;
} catch (error) {
  await db.exec`ROLLBACK`;
  throw error;
}
```

### Pagination

```typescript
const page = 1;
const pageSize = 20;
const offset = (page - 1) * pageSize;

const users = await db.all<User>`
  SELECT * FROM users
  ORDER BY created_at DESC
  LIMIT ${pageSize} OFFSET ${offset}
`;
```

### Full-Text Search (SQLite)

```typescript
// Create FTS table in migration
await db.exec`
  CREATE VIRTUAL TABLE posts_fts USING fts5(title, body)
`;

// Search
const results = await db.all<Post>`
  SELECT * FROM posts_fts WHERE posts_fts MATCH ${query}
`;
```

### JSON Columns (SQLite)

```typescript
// Store JSON
await db.exec`
  INSERT INTO settings (user_id, data)
  VALUES (${userId}, ${JSON.stringify(settings)})
`;

// Query JSON
const result = await db.get<{ theme: string }>`
  SELECT json_extract(data, '$.theme') as theme
  FROM settings WHERE user_id = ${userId}
`;
```

---

## ServiceWorker Integration

### Activate Event

Open databases during activation to run migrations:

```typescript
addEventListener("activate", (event) => {
  event.waitUntil(
    databases.open("main", 1, (e) => {
      e.waitUntil(runMigrations(e.db, e.oldVersion));
    })
  );
});

async function runMigrations(db: Database, oldVersion: number) {
  if (oldVersion < 1) {
    await db.exec`CREATE TABLE users (...)`;
  }
}
```

### Fetch Event

Use `databases.get()` for synchronous access:

```typescript
addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request: Request) {
  const db = databases.get("main");

  const url = new URL(request.url);
  if (url.pathname === "/api/users") {
    const users = await db.all`SELECT * FROM users`;
    return Response.json(users);
  }

  return new Response("Not Found", { status: 404 });
}
```

---

## Available Drivers

### Bun SQLite

Native Bun SQL (fastest for Bun runtime).

```json
{
  "databases": {
    "main": {
      "module": "@b9g/zen/bun",
      "url": "sqlite://./data/app.db"
    }
  }
}
```

### Better SQLite3

Node.js native module (synchronous API).

```json
{
  "databases": {
    "main": {
      "module": "@b9g/zen/better-sqlite3",
      "url": "sqlite://./data/app.db"
    }
  }
}
```

### SQL.js

WebAssembly SQLite (works everywhere, slower).

```json
{
  "databases": {
    "main": {
      "module": "@b9g/zen/sql.js",
      "url": "sqlite://./data/app.db"
    }
  }
}
```

### LibSQL

Turso/Cloudflare D1 compatible.

```json
{
  "databases": {
    "main": {
      "module": "@b9g/zen/libsql",
      "url": "$TURSO_URL",
      "authToken": "$TURSO_AUTH_TOKEN"
    }
  }
}
```

### Cloudflare D1

Native Cloudflare D1 binding.

```json
{
  "databases": {
    "main": {
      "binding": "DB"
    }
  }
}
```

---

## TypeScript

Shovel generates type definitions for your configured databases. After running `shovel build`, database names are type-checked:

```typescript
// OK - configured database
const db = databases.get("main");

// Type error - unconfigured database
const unknown = databases.get("not-configured");
```

---

## See Also

- [shovel.json](./shovel-json.md) - Full configuration reference
- [Caches](./caches.md) - Request/Response caching
- [Directories](./directories.md) - File system storage

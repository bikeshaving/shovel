# @b9g/zen

SQL database API with versioned migrations, inspired by [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)'s upgrade pattern.

See [ZenDB documentation](https://github.com/bikeshaving/ZenDB) for full API including Zod schemas and relationships.

---

## DatabaseStorage

Global `self.databases` provides access to configured databases.

### open(name: string, version: number, onUpgrade?: UpgradeCallback): Promise\<void\>

Opens a database with versioned migrations.

```typescript
await self.databases.open("main", 1, (event) => {
  event.waitUntil(
    event.db.exec`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`
  );
});
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | `string` | Database name from config |
| `version` | `number` | Target schema version |
| `onUpgrade` | `function` | Migration callback |

### get(name: string): Database

Gets a previously opened database (synchronous).

```typescript
const db = self.databases.get("main");
```

**Throws** if the database hasn't been opened.

### close(name: string): Promise\<void\>

Closes a database connection.

### closeAll(): Promise\<void\>

Closes all database connections.

---

## UpgradeEvent

Passed to the `onUpgrade` callback.

| Property | Type | Description |
|----------|------|-------------|
| `db` | `Database` | Database instance |
| `oldVersion` | `number` | Previous version (0 if new) |
| `newVersion` | `number` | Target version |

### waitUntil(promise: Promise\<any\>): void

Waits for the migration to complete.

```typescript
self.databases.open("main", 2, (event) => {
  event.waitUntil(
    (async () => {
      if (event.oldVersion < 1) {
        await event.db.exec`CREATE TABLE users (...)`;
      }
      if (event.oldVersion < 2) {
        await event.db.exec`ALTER TABLE users ADD COLUMN email TEXT`;
      }
    })()
  );
});
```

---

## Database

### exec\`sql\`: Promise\<void\>

Executes SQL without returning results.

```typescript
await db.exec`INSERT INTO users (name) VALUES (${"Alice"})`;
await db.exec`DROP TABLE IF EXISTS old_table`;
```

### all\<T\>\`sql\`: Promise\<T[]\>

Returns all matching rows.

```typescript
const users = await db.all<User>`SELECT * FROM users`;
```

### get\<T\>\`sql\`: Promise\<T | undefined\>

Returns the first matching row or undefined.

```typescript
const user = await db.get<User>`SELECT * FROM users WHERE id = ${1}`;
```

### query\<T\>\`sql\`: Promise\<T[]\>

Alias for `all`.

---

## Configuration

Configure in `shovel.json`:

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

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `module` | `string` | Driver module path |
| `export` | `string` | Named export (default: `"default"`) |
| `url` | `string` | Database connection URL |

### URL Formats

| Database | Format |
|----------|--------|
| SQLite | `sqlite://./path/to/db.sqlite` |
| PostgreSQL | `postgres://user:pass@host:5432/dbname` |

---

## Drivers

| Module | Description |
|--------|-------------|
| `@b9g/zen/bun` | Bun native SQLite |
| `@b9g/zen/better-sqlite3` | Node.js better-sqlite3 |
| `@b9g/zen/sql.js` | WebAssembly SQLite |
| `@b9g/zen/libsql` | Turso/LibSQL |

### Cloudflare D1

```json
{
  "databases": {
    "main": { "binding": "DB" }
  }
}
```

---

## See Also

- [shovel.json](./shovel-json.md) - Configuration reference
- [Cache](./cache.md) - Request/Response caching
- [FileSystem](./filesystem.md) - File storage


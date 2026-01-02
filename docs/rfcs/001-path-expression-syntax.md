# RFC 001: Expression Syntax for Configuration Values

## Summary

A domain-specific expression syntax for `shovel.json` configuration values that supports static literals, environment variables, special directories, fallbacks, and path joining—with safety guarantees against undefined values.

## Motivation

Configuration values need to work across:
- **Build time** - Resolving relative paths, embedding output directories
- **Runtime** - Reading environment variables, OS temp directories
- **Deployment environments** - Different values per environment with sensible defaults

Current problems:
1. `$ENVVAR` silently produces `"undefined/suffix"` when unset
2. No way to express "use env var if set, else fallback"
3. String concatenation causes double-slash issues (`/data//uploads`)
4. Hardcoded `process.env` and `node:os` don't work across all platforms

## Design Principles

1. **Fail fast** - Required env vars throw immediately if unset
2. **Explicit fallbacks** - No silent undefined, must specify default
3. **Proper path joining** - Use platform `joinPath()`, not string concatenation
4. **Unambiguous parsing** - Parentheses for grouping, clear delimiters
5. **Universal syntax** - Works in any config field, not just paths
6. **Platform agnostic** - Generated code uses platform adapters, not Node.js APIs directly

---

## Syntax

### Literal Values (Build-time Resolution)

For path fields:
```
./path              Relative to project directory
../path             Relative to parent directory
/absolute/path      Absolute path (as-is)
__outdir__          Build output directory
__outdir__/sub      Build output + suffix
```

For other fields, literals are used as-is.

**Generated code:** String literals with resolved values.

### Runtime Values

```
__tmpdir__          OS temp directory
__tmpdir__/sub      Temp directory + suffix
$ENVVAR             Required environment variable (throws if unset)
$ENVVAR/sub         Required env var + suffix (for path fields)
```

**Generated code:** Runtime expressions using platform adapters.

### Fallback Expressions

```
($ENVVAR || fallback)         Optional env var with fallback
($ENVVAR || fallback)/suffix  Optional env var + suffix (for path fields)
```

**Fallback** can be any literal or `__tmpdir__`:
- `($VAR || ./data)` - env var or relative path
- `($VAR || /var/data)` - env var or absolute path
- `($VAR || __outdir__/data)` - env var or build output
- `($VAR || __tmpdir__)` - env var or temp directory

---

## Grammar

```
expr          := grouped_expr | simple_expr
grouped_expr  := "(" env_ref "||" fallback ")" suffix?
simple_expr   := base suffix?

base          := env_ref | tmpdir_ref | outdir_ref | literal
env_ref       := "$" ENV_NAME
tmpdir_ref    := "__tmpdir__"
outdir_ref    := "__outdir__"
literal       := relative | absolute | bare
relative      := ("." | "..") "/" SEGMENT*
absolute      := "/" SEGMENT*
bare          := SEGMENT+

fallback      := tmpdir_ref suffix? | outdir_ref suffix? | literal
suffix        := ("/" SEGMENT)+

ENV_NAME      := [A-Z][A-Z0-9_]*
SEGMENT       := [^/()| ]+
```

**Note on bare literals:** A bare word like `SCREAMING_CASE` (without `$` prefix) is a literal string, not an environment variable reference. This is intentional—it allows values like Cloudflare binding names (`MY_KV_NAMESPACE`) to be used as literals without being interpreted as env vars. To reference an environment variable, always use the `$` prefix: `$MY_KV_NAMESPACE`.

---

## Platform Adapters

Generated code uses platform-provided functions rather than Node.js APIs directly:

```typescript
// @b9g/platform/runtime exports
export function env(name: string): string;           // throws if unset
export function envOr(name: string, fallback: string): string;
export function outdir(): string;                    // build output directory
export function tmpdir(): Promise<string>;           // OS temp directory (async)
export function joinPath(...segments: string[]): string;
```

### Platform Implementations

**Node.js / Bun:**
```typescript
export const env = (name: string) => {
  const value = import.meta.env[name];
  if (value === undefined) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
};
export const envOr = (name: string, fallback: string) =>
  import.meta.env[name] ?? fallback;
// outdir() uses build-time define injection (__SHOVEL_OUTDIR__)
declare const __SHOVEL_OUTDIR__: string | undefined;
export const outdir = () =>
  envOr("SHOVEL_OUTDIR", "") || __SHOVEL_OUTDIR__ || ".";
export const tmpdir = async () => (await import("node:os")).tmpdir();
export const joinPath = (...segments: string[]) =>
  segments.filter(Boolean).join("/").replace(/([^:])\/+/g, "$1/");
```

**Cloudflare Workers:**
```typescript
export const env = (name: string) => {
  const value = import.meta.env[name];
  if (value === undefined) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
};
export const envOr = (name: string, fallback: string) =>
  import.meta.env[name] ?? fallback;
declare const __SHOVEL_OUTDIR__: string | undefined;
export const outdir = () =>
  envOr("SHOVEL_OUTDIR", "") || __SHOVEL_OUTDIR__ || ".";
export const tmpdir = async () => {
  throw new Error("__tmpdir__ is not available on Cloudflare Workers");
};
export const joinPath = (...segments: string[]) =>
  segments.filter(Boolean).join("/").replace(/([^:])\/+/g, "$1/");
```

---

## Examples

### Configuration

```json
{
  "port": "$PORT",
  "host": "($HOST || 0.0.0.0)",
  "directories": {
    "server": { "path": "__outdir__/server" },
    "public": { "path": "__outdir__/public" },
    "tmp": { "path": "__tmpdir__" },
    "data": { "path": "./data" },
    "uploads": { "path": "($UPLOAD_DIR || ./data/uploads)" },
    "cache": { "path": "($CACHE_DIR || __tmpdir__)/myapp" },
    "db": { "path": "($DB_PATH || ./data)/shovel.db" },
    "logs": { "path": "$LOG_DIR/myapp" }
  },
  "databases": {
    "main": {
      "url": "$DATABASE_URL"
    }
  }
}
```

### Generated Code

```javascript
import { env, envOr, outdir, tmpdir, joinPath } from "@b9g/platform/runtime";

export default {
  port: Number(env("PORT")),
  host: envOr("HOST", "0.0.0.0"),
  directories: {
    server: { path: joinPath(outdir(), "server") },
    public: { path: joinPath(outdir(), "public") },
    tmp: { path: await tmpdir() },
    data: { path: "/home/user/project/data" },
    uploads: {
      path: envOr("UPLOAD_DIR", "/home/user/project/data/uploads")
    },
    cache: {
      path: joinPath(envOr("CACHE_DIR", await tmpdir()), "myapp")
    },
    db: {
      path: joinPath(envOr("DB_PATH", "/home/user/project/data"), "shovel.db")
    },
    logs: {
      path: joinPath(env("LOG_DIR"), "myapp")
    },
  },
  databases: {
    main: {
      url: env("DATABASE_URL"),
    }
  }
}
```

---

## Type Coercion

The expression syntax is universal, but type coercion depends on the field's schema:

| Field Type | Expression | Generated Code |
|------------|------------|----------------|
| `string` | `$VAR` | `env("VAR")` |
| `number` | `$VAR` | `Number(env("VAR"))` |
| `boolean` | `$VAR` | `env("VAR") === "true"` |
| `string` | `($VAR \|\| default)` | `envOr("VAR", "default")` |
| `number` | `($VAR \|\| 3000)` | `Number(envOr("VAR", "3000"))` |

Path fields additionally support:
- Relative path resolution (`./`, `../`)
- Special directories (`__outdir__`, `__tmpdir__`)
- Path joining via suffix (`/sub/path`)

---

## Semantics

### Path Joining

Suffixes use `joinPath()`:

```javascript
// $DATADIR/uploads/images
joinPath(env("DATADIR"), "uploads", "images")

// __tmpdir__/myapp/cache
joinPath(tmpdir(), "myapp", "cache")

// ($VAR || ./data)/sub/path
joinPath(envOr("VAR", "/abs/data"), "sub", "path")
```

Benefits:
- Handles trailing slashes correctly
- Normalizes paths
- Platform-appropriate separators

### Required vs Optional

| Syntax | Behavior |
|--------|----------|
| `$VAR` | **Required** - throws `Error` if unset |
| `($VAR \|\| default)` | **Optional** - uses fallback if unset |

Empty string (`VAR=""`) is considered "set" - only `undefined` triggers fallback/error.

### Resolution Timing

| Pattern | Resolved |
|---------|----------|
| `./path`, `../path`, `/path` | Build time |
| `__outdir__`, `__outdir__/sub` | Runtime (via build-time define injection) |
| `__tmpdir__`, `__tmpdir__/sub` | Runtime |
| `$VAR`, `$VAR/sub` | Runtime |
| `($VAR \|\| literal)` | Mixed: fallback at build, check at runtime |

---

## Edge Cases

### Empty Environment Variable
```javascript
// DATADIR="" (set but empty)
envOr("DATADIR", "/fallback")  // returns "" (empty string, not fallback)
```
Empty is valid. Use validation elsewhere if empty should be rejected.

### Whitespace in Expressions
```json
"( $DATADIR || ./data )/uploads"   // OK - whitespace allowed inside parens
"$DATADIR / uploads"               // Invalid - no spaces in suffix
```

### Platform Compatibility

Platform-specific syntax validation occurs during the **build phase** when generating the config module:

1. **Parser phase** (`parsePath()`) - Parses expressions and identifies runtime dependencies (`__tmpdir__`, env vars)
2. **Config generation phase** (`generateConfigModule()`) - Platform adapter checks for incompatible features
3. **Build error** - If `__tmpdir__` is used with Cloudflare target, build fails with clear error message

At **runtime**, the platform adapter functions handle any remaining platform differences:
- `tmpdir()` throws `Error("__tmpdir__ is not available on Cloudflare Workers")` if somehow reached
- `joinPath()` uses `/` separator on all platforms (Cloudflare has no `path` module)

---

## Not Supported (v1)

| Feature | Example | Reason |
|---------|---------|--------|
| Chained fallbacks | `($A \|\| $B \|\| ./c)` | Complexity; add later if needed |
| Env var as fallback | `($A \|\| $B)` | Both need runtime check |
| Nested groups | `(($A \|\| $B) \|\| ./c)` | Complexity |
| Escaping | `\$LITERAL` | Rare need |
| Lowercase env vars | `$datadir` | Convention is SCREAMING_CASE |
| Interpolation | `${DIR}_suffix` | Use suffix syntax instead |

---

## Breaking Changes

From current behavior:

| Before | After |
|--------|-------|
| `$VAR` when unset produces `"undefined"` | Throws `Error` |
| `$VAR/sub` uses string concatenation | Uses `joinPath()` |
| Generated code uses `process.env` | Uses `import.meta.env` via platform adapter |

---

## Future Extensions

Possible additions for v2+:

```javascript
// More dunders
__projectdir__      // Project root
__homedir__         // User home directory

// Chained fallbacks
($PRIMARY || $SECONDARY || ./default)

// Type-specific syntax
$PORT:number        // Explicit type annotation
```

---

## Summary

| Pattern | Example | Generated Code |
|---------|---------|----------------|
| Literal | `./data` | `"/abs/project/data"` |
| Output dir | `__outdir__/server` | `joinPath(outdir(), "server")` |
| Temp dir | `__tmpdir__/cache` | `joinPath(await tmpdir(), "cache")` |
| Required env | `$DATADIR/uploads` | `joinPath(env("DATADIR"), "uploads")` |
| Optional env | `($DATADIR \|\| ./data)/uploads` | `joinPath(envOr("DATADIR", "/abs/data"), "uploads")` |

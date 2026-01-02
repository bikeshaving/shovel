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
3. **Proper path joining** - Use inline array joining, not string concatenation
4. **Unambiguous parsing** - Parentheses for grouping, clear delimiters
5. **Universal syntax** - Works in any config field, not just paths
6. **Platform agnostic** - Generated code uses `process.env` (universal baseline)
7. **Familiar syntax** - Uses `[bracket]` placeholders similar to esbuild/webpack output filename templating

---

## Syntax

### Literal Values (Build-time Resolution)

For path fields:
```
./path              Relative to project directory
../path             Relative to parent directory
/absolute/path      Absolute path (as-is)
[outdir]            Build output directory
[outdir]/sub        Build output + suffix
```

For other fields, literals are used as-is.

**Generated code:** String literals with resolved values.

### Runtime Values

```
[tmpdir]            OS temp directory
[tmpdir]/sub        Temp directory + suffix
[git]               Git commit SHA (deployment identifier)
$ENVVAR             Required environment variable (throws if unset)
$ENVVAR/sub         Required env var + suffix (for path fields)
```

**Generated code:** Runtime expressions.

### Fallback Expressions

```
($ENVVAR || fallback)         Optional env var with fallback
($ENVVAR || fallback)/suffix  Optional env var + suffix (for path fields)
```

**Fallback** can be any literal or `[tmpdir]`:
- `($VAR || ./data)` - env var or relative path
- `($VAR || /var/data)` - env var or absolute path
- `($VAR || [outdir]/data)` - env var or build output
- `($VAR || [tmpdir])` - env var or temp directory

---

## Bracket Placeholders

The bracket placeholder syntax (`[outdir]`, `[tmpdir]`, `[git]`) is intentionally similar to esbuild and webpack's output filename templating syntax (e.g., `[name]`, `[hash]`, `[ext]`). This provides a familiar pattern for developers coming from those ecosystems.

| Placeholder | Description | Resolution Time | Generated Code |
|------------|-------------|-----------------|----------------|
| `[outdir]` | Build output directory | Build time | `__SHOVEL_OUTDIR__` (esbuild define) |
| `[tmpdir]` | OS temp directory | Runtime | `tmpdir()` (from platform entry wrapper) |
| `[git]` | Git commit SHA | Build time | `__SHOVEL_GIT__` (esbuild define) |

### Platform Support

| Placeholder | Node.js/Bun | Cloudflare Workers |
|------------|-------------|-------------------|
| `[outdir]` | ✅ Supported | ❌ No filesystem |
| `[tmpdir]` | ✅ Supported | ❌ No filesystem |
| `[git]` | ✅ Supported | ✅ Supported |

---

## Grammar

```
expr          := grouped_expr | simple_expr
grouped_expr  := "(" env_ref "||" fallback ")" suffix?
simple_expr   := base suffix?

base          := env_ref | tmpdir_ref | outdir_ref | git_ref | literal
env_ref       := "$" ENV_NAME
tmpdir_ref    := "[tmpdir]"
outdir_ref    := "[outdir]"
git_ref       := "[git]"
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

## Examples

### Configuration

```json
{
  "port": "$PORT || 3000",
  "host": "$HOST || 0.0.0.0",
  "directories": {
    "server": { "path": "[outdir]/server" },
    "public": { "path": "[outdir]/public" },
    "tmp": { "path": "[tmpdir]" },
    "data": { "path": "./data" },
    "uploads": { "path": "($UPLOAD_DIR || ./data/uploads)" },
    "cache": { "path": "($CACHE_DIR || [tmpdir])/myapp" },
    "db": { "path": "($DB_PATH || ./data)/shovel.db" },
    "logs": { "path": "$LOG_DIR/myapp" }
  },
  "databases": {
    "main": {
      "url": "$DATABASE_URL"
    }
  },
  "deploymentId": "[git]"
}
```

### Generated Code

```javascript
// Platform entry wrappers provide: import {tmpdir} from "os";

export const config = {
  get port() { return process.env.PORT || 3000; },
  get host() { return process.env.HOST || "0.0.0.0"; },
  directories: {
    server: { path: [__SHOVEL_OUTDIR__, "server"].filter(Boolean).join("/") },
    public: { path: [__SHOVEL_OUTDIR__, "public"].filter(Boolean).join("/") },
    tmp: { path: tmpdir() },
    data: { path: "/home/user/project/data" },
    uploads: {
      path: process.env.UPLOAD_DIR || "/home/user/project/data/uploads"
    },
    cache: {
      get path() { return [(process.env.CACHE_DIR || tmpdir()), "myapp"].filter(Boolean).join("/"); }
    },
    db: {
      path: [(process.env.DB_PATH || "/home/user/project/data"), "shovel.db"].filter(Boolean).join("/")
    },
    logs: {
      get path() { return [process.env.LOG_DIR, "myapp"].filter(Boolean).join("/"); }
    },
  },
  databases: {
    main: {
      get url() { return process.env.DATABASE_URL; },
    }
  },
  deploymentId: __SHOVEL_GIT__,
};
```

---

## Code Generation

The config expression system generates JavaScript code directly without runtime helper functions:

| Expression | Generated Code |
|------------|----------------|
| `$VAR` | `process.env.VAR` |
| `$VAR \|\| fallback` | `process.env.VAR \|\| "fallback"` |
| `[outdir]` | `__SHOVEL_OUTDIR__` |
| `[tmpdir]` | `tmpdir()` |
| `[git]` | `__SHOVEL_GIT__` |
| `$VAR/sub` | `[process.env.VAR, "sub"].filter(Boolean).join("/")` |
| `[outdir]/sub` | `[__SHOVEL_OUTDIR__, "sub"].filter(Boolean).join("/")` |

### Dynamic vs Static Values

Values containing runtime expressions (`process.env`, `tmpdir()`) are wrapped in getters to ensure they're evaluated at access time, not module load time:

```javascript
// Static value - evaluated once at build time
data: { path: "/resolved/absolute/path" }

// Dynamic value - getter ensures fresh evaluation
logs: { get path() { return [process.env.LOG_DIR, "myapp"].filter(Boolean).join("/"); } }
```

---

## Semantics

### Path Joining

Suffixes use inline array joining:

```javascript
// $DATADIR/uploads/images
[process.env.DATADIR, "uploads", "images"].filter(Boolean).join("/")

// [tmpdir]/myapp/cache
[tmpdir(), "myapp", "cache"].filter(Boolean).join("/")

// ($VAR || ./data)/sub/path
[(process.env.VAR || "/abs/data"), "sub", "path"].filter(Boolean).join("/")
```

Benefits:
- Handles empty/undefined segments correctly via `filter(Boolean)`
- No additional runtime dependencies
- Works identically across all platforms

### Required vs Optional

| Syntax | Behavior |
|--------|----------|
| `$VAR` | Uses value if set, `undefined` if not |
| `$VAR \|\| fallback` | Uses fallback if falsy (empty string, undefined, null) |
| `$VAR ?? fallback` | Uses fallback only if null/undefined (keeps empty string) |

### Resolution Timing

| Pattern | Resolved |
|---------|----------|
| `./path`, `../path`, `/path` | Build time (absolute path embedded) |
| `[outdir]`, `[outdir]/sub` | Build time (via `__SHOVEL_OUTDIR__` define) |
| `[git]` | Build time (via `__SHOVEL_GIT__` define) |
| `[tmpdir]`, `[tmpdir]/sub` | Runtime (via `tmpdir()` call) |
| `$VAR`, `$VAR/sub` | Runtime (via `process.env`) |

---

## Platform Entry Wrappers

The `[tmpdir]` placeholder generates a `tmpdir()` call. This function is provided by platform entry wrappers via a static import:

```javascript
// Node.js / Bun entry wrapper
import {tmpdir} from "os"; // For [tmpdir] config expressions
```

Cloudflare Workers do not support `[tmpdir]` or `[outdir]` since they have no filesystem access. The build will fail if these are used with the Cloudflare platform.

---

## Edge Cases

### Empty Environment Variable
```javascript
// DATADIR="" (set but empty)
process.env.DATADIR || "/fallback"  // returns "/fallback" (empty string is falsy)
process.env.DATADIR ?? "/fallback"  // returns "" (nullish coalescing keeps empty)
```

### Whitespace in Expressions
```json
"( $DATADIR || ./data )/uploads"   // OK - whitespace allowed inside parens
"$DATADIR / uploads"               // Invalid - no spaces in suffix
```

### Platform Compatibility

Platform-specific syntax validation occurs during the **build phase**:

1. **Parser phase** - Parses expressions and identifies placeholders (`[tmpdir]`, `[outdir]`, `[git]`)
2. **Platform check** - Platform adapter rejects incompatible placeholders
3. **Build error** - If `[tmpdir]` is used with Cloudflare target, build fails with clear error message

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

## Summary

| Pattern | Example | Generated Code |
|---------|---------|----------------|
| Literal | `./data` | `"/abs/project/data"` |
| Output dir | `[outdir]/server` | `[__SHOVEL_OUTDIR__, "server"].filter(Boolean).join("/")` |
| Temp dir | `[tmpdir]/cache` | `[tmpdir(), "cache"].filter(Boolean).join("/")` |
| Git SHA | `[git]` | `__SHOVEL_GIT__` |
| Required env | `$DATADIR/uploads` | `[process.env.DATADIR, "uploads"].filter(Boolean).join("/")` |
| Optional env | `($DATADIR \|\| ./data)/uploads` | `[(process.env.DATADIR \|\| "/abs/data"), "uploads"].filter(Boolean).join("/")` |

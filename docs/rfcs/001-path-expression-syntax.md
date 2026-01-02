# RFC 001: Config Expression Syntax

## Summary

A domain-specific expression language for `shovel.json` configuration values. Supports environment variables, bracket placeholders, operators, and path joining—generating JavaScript code that's evaluated at runtime.

## Overview

The config expression system parses string values in `shovel.json` and generates JavaScript code. This enables:

- **Environment-driven config**: `"$PORT || 3000"` → `process.env.PORT || 3000`
- **Build-time constants**: `"[outdir]/server"` → `__SHOVEL_OUTDIR__ + "/server"`
- **Runtime values**: `"[tmpdir]/cache"` → `tmpdir() + "/cache"`
- **Conditional logic**: `"$NODE_ENV === production ? redis : memory"`

## Syntax

### Environment Variables

```
$VAR                    → process.env.VAR
$VAR || fallback        → process.env.VAR || "fallback"
$VAR ?? fallback        → process.env.VAR ?? "fallback"
```

### Bracket Placeholders

| Placeholder | Description | Resolution | Generated Code |
|-------------|-------------|------------|----------------|
| `[outdir]` | Build output directory | Build time | `__SHOVEL_OUTDIR__` |
| `[tmpdir]` | OS temp directory | Runtime | `tmpdir()` |
| `[git]` | Git commit SHA | Build time | `__SHOVEL_GIT__` |

The bracket syntax mirrors esbuild/webpack output filename templating (`[name]`, `[hash]`).

### Operators

| Operator | Example | Description |
|----------|---------|-------------|
| `\|\|` | `$VAR \|\| default` | Logical OR (falsy fallback) |
| `??` | `$VAR ?? default` | Nullish coalescing |
| `&&` | `$A && $B` | Logical AND |
| `? :` | `$ENV === prod ? a : b` | Ternary conditional |
| `===`, `!==` | `$ENV === production` | Strict equality |
| `==`, `!=` | `$ENV == production` | Loose equality |
| `!` | `!$DISABLED` | Logical NOT |

### Literals

- **Strings**: `redis`, `localhost`, `my-bucket-name`
- **Numbers**: `3000`, `8080`
- **Booleans**: `true`, `false`
- **Quoted strings**: `"with spaces"`, `'single quotes'`
- **Keywords**: `null`, `undefined`

### Path Expressions

Path expressions extend the base syntax with:

1. **Path suffixes**: Append path segments with `/`
2. **Relative resolution**: `./path` resolved to absolute at build time

```
$DATADIR/uploads        → [process.env.DATADIR, "uploads"].filter(Boolean).join("/")
[outdir]/server         → [__SHOVEL_OUTDIR__, "server"].filter(Boolean).join("/")
./data                  → "/absolute/path/to/data"
```

---

## Code Generation

### Expression to Code

| Expression | Generated Code |
|------------|----------------|
| `$VAR` | `process.env.VAR` |
| `$VAR \|\| 3000` | `process.env.VAR \|\| 3000` |
| `[outdir]` | `__SHOVEL_OUTDIR__` |
| `[tmpdir]` | `tmpdir()` |
| `[git]` | `__SHOVEL_GIT__` |
| `$VAR/sub` | `[process.env.VAR, "sub"].filter(Boolean).join("/")` |
| `$A === prod ? x : y` | `process.env.A === "prod" ? "x" : "y"` |

### Static vs Dynamic

The code generator tracks whether expressions contain runtime values:

```javascript
// Static - no runtime dependencies, inline value
data: { path: "/resolved/absolute/path" }

// Dynamic - contains process.env or tmpdir(), use getter
logs: {
  get path() {
    return [process.env.LOG_DIR, "myapp"].filter(Boolean).join("/");
  }
}
```

Dynamic values use getters to ensure evaluation at access time, not module load time.

---

## Example

### shovel.json

```json
{
  "port": "$PORT || 3000",
  "host": "$HOST || 0.0.0.0",
  "directories": {
    "server": { "path": "[outdir]/server" },
    "public": { "path": "[outdir]/public" },
    "tmp": { "path": "[tmpdir]" },
    "data": { "path": "./data" },
    "cache": { "path": "($CACHE_DIR || [tmpdir])/myapp" }
  },
  "databases": {
    "main": { "url": "$DATABASE_URL" }
  },
  "cache": {
    "provider": "$NODE_ENV === production ? redis : memory"
  }
}
```

### Generated config.js

```javascript
import {tmpdir} from "os";

export const config = {
  get port() { return process.env.PORT || 3000; },
  get host() { return process.env.HOST || "0.0.0.0"; },
  directories: {
    server: { path: [__SHOVEL_OUTDIR__, "server"].filter(Boolean).join("/") },
    public: { path: [__SHOVEL_OUTDIR__, "public"].filter(Boolean).join("/") },
    tmp: { path: tmpdir() },
    data: { path: "/home/user/project/data" },
    cache: {
      get path() {
        return [(process.env.CACHE_DIR || tmpdir()), "myapp"].filter(Boolean).join("/");
      }
    },
  },
  databases: {
    main: { get url() { return process.env.DATABASE_URL; } }
  },
  cache: {
    get provider() { return process.env.NODE_ENV === "production" ? "redis" : "memory"; }
  },
};
```

---

## Platform Support

| Feature | Node.js/Bun | Cloudflare Workers |
|---------|-------------|-------------------|
| `$VAR` | ✅ | ✅ |
| `[outdir]` | ✅ | ❌ No filesystem |
| `[tmpdir]` | ✅ | ❌ No filesystem |
| `[git]` | ✅ | ✅ |
| Operators | ✅ | ✅ |

Platform entry wrappers provide the `tmpdir` function via `import {tmpdir} from "os"`.

---

## Implementation

The expression system is implemented in `src/utils/config.ts`:

1. **Tokenizer** - Lexes input into tokens (env vars, operators, literals, placeholders)
2. **Parser** - Recursive descent parser builds AST, evaluates with platform functions
3. **CodeGenerator** - Generates JavaScript code from tokens

Key functions:
- `exprToCode(expr)` - Convert expression string to JS code
- `generateConfigModule(config, platform)` - Generate full config.js module
- `isExpression(value)` - Check if string contains expression syntax

---

## Grammar

```
expr          := ternary
ternary       := or ("?" expr ":" expr)?
or            := and (("||" | "??") and)*
and           := equality ("&&" equality)*
equality      := primary (("===" | "!==" | "==" | "!=") primary)*
primary       := "!" primary | "(" expr ")" suffix? | atom suffix?

atom          := env_ref | placeholder | literal
env_ref       := "$" IDENTIFIER
placeholder   := "[outdir]" | "[tmpdir]" | "[git]"
literal       := NUMBER | BOOLEAN | NULL | UNDEFINED | STRING | IDENTIFIER

suffix        := ("/" SEGMENT)+
SEGMENT       := [^/()| ]+
IDENTIFIER    := [A-Za-z_][A-Za-z0-9_]*
```

---

## Design Decisions

**Why `process.env` directly?**
All target platforms (Node.js, Bun, Cloudflare) support `process.env`. Using it directly avoids abstraction overhead and makes generated code readable.

**Why bracket placeholders?**
The `[name]` syntax is familiar from esbuild/webpack. It's visually distinct from `$ENV_VARS` and clearly indicates "magic values" rather than environment variables.

**Why getters for dynamic values?**
Environment variables can change during runtime. Getters ensure `config.port` always returns the current value of `process.env.PORT`, not a stale captured value.

**Why inline path joining?**
`[a, b].filter(Boolean).join("/")` handles undefined segments gracefully and requires no runtime dependencies. It's also easy to read in generated code.

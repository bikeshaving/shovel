# Shovel Configuration Design

**A rapid-fire design session that landed on something wonderful**

Date: 2025-11-23

## The Big Idea: exprenv DSL

### What Is It?

**Embeddable JavaScript expressions for JSON configuration.**

Instead of:
```json
{
  "port": "${PORT:-3000}"  // Bash-style (limited)
}
```

Or:
```json
{
  "development": {"cache": "memory"},
  "production": {"cache": "redis"}  // Duplication
}
```

We created:
```json
{
  "port": "PORT || 3000",
  "cache": {
    "provider": "NODE_ENV === production ? redis : memory"
  }
}
```

### Why It's Special

1. **It's just JavaScript** - developers already know it
2. **No quote hell** - `redis` not `\"redis\"`
3. **Powerful** - conditionals, comparisons, logic
4. **Explicit** - you can SEE what env vars matter
5. **Self-documenting** - grep for "PORT" and find it
6. **Secure** - blocks function calls, sandboxed eval

### Syntax Rules

**Identifiers:**
- `ALL_CAPS` → env var reference (e.g., `NODE_ENV`, `PORT`)
- `lowercase` → string literal (e.g., `redis`, `memory`)
- `PascalCase` → string literal (e.g., `MemoryCache`)
- `"quoted"` → explicit string (escape hatch)

**Keywords:**
- `true`, `false`, `null`, `undefined` → JavaScript literals

**Operators:**
- `||` → fallback/OR
- `&&` → logical AND
- `===`, `!==` → strict equality
- `==`, `!=` → loose equality (for null checks)
- `? :` → ternary
- `!` → negation

**No function calls allowed** - security

### Examples

```json
{
  "port": "PORT || 3000",
  "workers": "WEB_CONCURRENCY || 4",
  "cache": {
    "provider": "NODE_ENV === production ? redis : memory",
    "url": "REDIS_URL",
    "enabled": "!DISABLE_CACHE"
  },
  "buckets": {
    "uploads": {
      "provider": "USE_S3 && NODE_ENV === production ? s3 : disk",
      "bucket": "S3_BUCKET || devUploads"
    }
  }
}
```

### Gotchas & Solutions

**Gotcha: String "false" is truthy**
```json
❌ "enabled": "USE_CACHE ? true : false"  // "false" is truthy!
✅ "enabled": "NODE_ENV === production"    // Explicit comparison
```

**Solution: Use explicit comparisons, not truthy checks**

**Gotcha: Empty string "" vs undefined**
- `undefined` → env var not set
- `""` → env var set to empty (intentionally falsy)

**Solution: Both are falsy, use `== null` to check for undefined**

**Gotcha: No hyphens in identifiers**
```json
❌ "bucket": "S3_BUCKET || dev-uploads"  // Parse error!
✅ "bucket": "S3_BUCKET || devUploads"   // camelCase
```

### Implementation

Location: `src/config.ts`

Algorithm:
1. Preserve quoted strings with placeholders
2. Transform `ALL_CAPS` → `__ENV__.IDENTIFIER`
3. Quote `lowercase`/`PascalCase` → `"string"`
4. Replace `__ENV__` → `env`
5. Restore quoted strings
6. Eval with `new Function('env', expr)`
7. Auto-convert numeric strings to numbers

```typescript
parseConfigExpr("PORT || 3000", {PORT: "8080"})  // → 8080 (number)
parseConfigExpr("NODE_ENV === production ? redis : memory", {NODE_ENV: "production"})  // → "redis"
```

## Key Design Decisions

### 1. Explicit > Implicit

**Decision: Use expressions everywhere, no magic conventions**

❌ Rejected: Auto-override by convention
```json
{"port": 3000}  // Magic: PORT env var auto-overrides
```

✅ Chosen: Explicit expressions
```json
{"port": "PORT || 3000"}  // Clear: checks PORT, falls back to 3000
```

**Rationale:**
- Self-documenting - you can SEE which env vars matter
- Grepable - search "PORT" finds the config
- No surprises - zero hidden behavior
- Explicit > Implicit (Zen of Python, JS best practice)
- Docker Compose uses explicit syntax too

**Trade-off:** 9 extra characters for crystal clarity. Worth it.

### 2. Strict Mode by Default

**Decision: Require all env vars to be defined OR have fallbacks**

```json
✅ "port": "PORT || 3000"        // Has fallback - OK
✅ "url": "REDIS_URL == null ? memory : redis"  // Null check - OK
✅ "enabled": "!DISABLE_CACHE"   // Negation - OK
❌ "url": "REDIS_URL"            // No fallback - ERROR!
```

**Error message:**
```
Undefined environment variable: REDIS_URL
Expression: REDIS_URL
Fix:
  1. Set the env var: export REDIS_URL=value
  2. Add a fallback: REDIS_URL || defaultValue
  3. Add null check: REDIS_URL == null ? ... : ...
  4. Use empty string for falsy: export REDIS_URL=""
```

**Rationale:**
- Prevents "works in dev, breaks in prod" incidents
- Catches typos in development
- Forces intentional handling of undefined
- Empty string `""` is allowed (intentionally falsy)
- Can opt-out with `{strict: false}`

**Quote:** "Convenience over correctness is how you get 3am production incidents"

### 3. Per-Name Config with Pattern Matching

**Decision: Both caches and buckets use per-name config with wildcard patterns**

```json
{
  "caches": {
    "api-*": {           // Pattern: matches api-v1, api-v2, etc.
      "provider": "redis",
      "ttl": 300
    },
    "sessions": {        // Exact: matches "sessions" only
      "provider": "redis",
      "ttl": 86400
    },
    "*": {               // Catch-all: matches everything else
      "provider": "memory",
      "maxEntries": 1000
    }
  },
  "buckets": {
    "uploads": {
      "provider": "NODE_ENV === production ? s3 : disk",
      "bucket": "S3_UPLOADS_BUCKET"
    },
    "*": {
      "provider": "disk"
    }
  }
}
```

**Pattern Matching Rules:**
1. **Exact match first** - `"sessions"` matches `"sessions"`
2. **Prefix patterns** - `"api-*"` matches `"api-v1"`, `"api-v2"`
   - Longest prefix wins (most specific)
3. **Catch-all** - `"*"` matches everything else

**Why patterns?**
- Cache names are often versioned: `api-v1`, `api-v2`
- Can't use env expressions in keys (too confusing)
- `*` is obviously a pattern (vs "default" which looks like a name)
- Familiar from `.gitignore`, shell globs, routing

**Why per-name for both?**
- **Caches:** Different caches need different config (sessions vs api vs static)
- **Buckets:** Each bucket is different infrastructure (uploads vs static vs tmp)
- Consistency - same pattern for both

**Rejected:** Global cache config (not flexible enough)

### 4. import.meta.env Support

**Decision: Prefer `import.meta.env`, fallback to `process.env`**

```typescript
function getEnv() {
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env;  // Vite, Deno, modern runtimes
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env;  // Node.js
  }
  return {};  // No env available
}
```

**Rationale:**
- `import.meta.env` is more modern
- Works in Vite, Deno, browsers (with bundlers)
- Still supports Node.js via `process.env`

### 5. Static Keys, Dynamic Values

**Decision: JSON keys must be static identifiers, values can use DSL**

```json
✅ {
  "caches": {
    "sessions": {                    // Static key
      "provider": "ENV === prod ? redis : memory"  // Dynamic value
    }
  }
}

❌ {
  "caches": {
    "CACHE_NAME || sessions": {      // NO! Confusing
      "provider": "redis"
    }
  }
}
```

**Rationale:**
- Keys define structure (what caches/buckets exist)
- Values define behavior (how they're configured)
- Keeps JSON readable and predictable

## Final Schema

### Complete Example

```json
{
  "name": "my-saas-app",
  "shovel": {
    "port": "PORT || 3000",
    "host": "HOST || 0.0.0.0",
    "workers": "WEB_CONCURRENCY || 1",

    "caches": {
      "api-*": {
        "provider": "NODE_ENV === production ? redis : memory",
        "ttl": 300
      },
      "sessions": {
        "provider": "redis",
        "url": "REDIS_URL",
        "ttl": 86400
      },
      "*": {
        "provider": "memory",
        "maxEntries": 1000
      }
    },

    "buckets": {
      "static": {
        "provider": "disk",
        "path": "./public"
      },
      "uploads": {
        "provider": "NODE_ENV === production ? s3 : disk",
        "bucket": "S3_UPLOADS_BUCKET || devUploads",
        "region": "AWS_REGION || us-east-1",
        "path": "./uploads"
      },
      "tmp": {
        "provider": "disk",
        "path": "./tmp"
      },
      "*": {
        "provider": "disk"
      }
    }
  }
}
```

### TypeScript Types

```typescript
interface ShovelConfig {
  // Server
  port?: number | string;
  host?: string;
  workers?: number | string;

  // Caches (per-name with patterns)
  caches?: {
    [nameOrPattern: string]: {
      provider?: string;
      url?: string;
      maxEntries?: number | string;
      ttl?: number | string;
    };
  };

  // Buckets (per-name with patterns)
  buckets?: {
    [nameOrPattern: string]: {
      provider?: string;
      path?: string;      // For disk provider
      bucket?: string;    // For S3 provider
      region?: string;    // For S3 provider
      endpoint?: string;  // For S3-compatible services
    };
  };
}
```

## Comparison with Alternatives

### vs Docker Compose (`${VAR:-default}`)

| Feature | Docker | exprenv |
|---------|--------|---------|
| Fallbacks | ✅ | ✅ |
| Conditionals | ❌ | ✅ |
| Comparisons | ❌ | ✅ |
| Logic (&&, \|\|, !) | ❌ | ✅ |
| Readability | Bash-ish | JavaScript |
| Nested quotes | ❌ Need escaping | ✅ None needed |

### vs Explicit Environment Sections

```json
❌ {
  "development": {"cache": "memory"},
  "production": {"cache": "redis"}
}
```

Problems:
- Duplication
- Can't handle intermediate environments
- What about staging? preview? local-with-redis?

✅ exprenv handles all cases:
```json
{
  "cache": {
    "provider": "NODE_ENV === production ? redis : memory"
  }
}
```

### vs JavaScript Config Files

```javascript
❌ export default {
  port: process.env.PORT || 3000
}
```

Problems:
- Not serializable (can't be in package.json)
- Harder to validate
- Can't be easily edited by tools
- Runtime-only

✅ JSON + exprenv:
- Serializable
- Versionable
- Tool-friendly
- Validated at load time

## Implementation Status

**Completed:**
- ✅ DSL parser (`src/config.ts`)
- ✅ 21 passing tests (`src/config.test.ts`)
- ✅ Strict mode by default
- ✅ `import.meta.env` + `process.env` support
- ✅ Auto number coercion
- ✅ Helpful error messages

**TODO:**
- [ ] Pattern matching implementation (`matchPattern()`)
- [ ] Config schema types
- [ ] Config loader (reads package.json)
- [ ] Integration with platforms
- [ ] Validation command (`shovel validate`)
- [ ] Documentation

## Why This Is Special

**No one has done this before** because:
1. Most config is in separate files (.env, config.json)
2. Tools use bash-style `${VAR}` interpolation (limited)
3. Or explicit environment sections (duplication)
4. Or JavaScript files (not serializable)

**We combined:**
- JSON (serializable, tool-friendly)
- JavaScript expressions (powerful, familiar)
- Zero-config defaults (works without config)
- 12-factor principles (env-aware)

**Result:** Configuration that's both simple AND powerful.

## Future Possibilities

**If we extract to `exprenv` package:**
- Works with any JSON config (not just Shovel)
- Could support YAML, TOML too
- VSCode extension for syntax highlighting
- Linter for catching gotchas
- CLI tool for testing expressions

**For now:** Proven in Shovel first, extract later if valuable.

## Quotes from the Design Session

> "This is kinda neat no???"

> "I can't believe no one has thought of this"

> "our DSL good their DSL bad"

> "what about cache by name and defaults"

> "what's good for docker compose is good enough for me"

> "Convenience over correctness is how you get 3am production incidents"

> "it's explicit but annoying" → led to the strict mode discussion

> "Are there any cases where caches might want per-name config?"

> "You seem to want it as a separate package" → we decided to keep it inline for now

> "Can we get a record of all the decisions we made first?"

---

**This document captures a design session that felt like magic.**

The key was asking the right questions, exploring trade-offs honestly, and landing on something that feels **obvious in retrospect** but nobody had done before.

**exprenv: JavaScript expressions for environment-aware JSON config** 🔥

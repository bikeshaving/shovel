# Generator-Based Middleware

## Overview

Generator-based middleware provides **guaranteed execution** where all middleware executes regardless of early returns, while eliminating the fundamental control flow bugs inherent in callback-based `next()` APIs. This approach makes it syntactically impossible to forget to call `next()` or call it outside the proper control flow.

## Core Design Principles

### 1. Eliminates Control Flow Bugs

Traditional callback-based middleware (`next()` style) suffers from fundamental control flow bugs that have plagued JavaScript frameworks for decades:

#### The Forgotten `next()` Bug
```javascript
// Express/Koa style - COMMON BUG
async function authMiddleware(req, res, next) {
  const user = await validateAuth(req);

  if (!user) {
    return res.status(401).send('Unauthorized'); // BUG: Forgot next()!
    // Request hangs - no response sent, but also no continuation
  }

  if (user.suspended) {
    return res.status(403).send('Suspended'); // BUG: Forgot next() again!
  }

  req.user = user;
  await next(); // Only called in success case
}
```

#### The Async `next()` Bug
```javascript
// Express/Koa style - SUBTLE BUG
async function middleware(req, res, next) {
  someAsyncOperation()
    .then(() => {
      next(); // BUG: Called outside middleware resolution!
    })
    .catch(() => {
      next(); // BUG: Multiple next() calls possible!
    });

  // Middleware resolves immediately, but next() called later
  return; // Framework thinks middleware is done
}
```

#### Generator Middleware: Syntactically Impossible Bugs
```javascript
// Generator style - IMPOSSIBLE to have these bugs
async function* authMiddleware(request, context) {
  const user = await validateAuth(request);

  if (!user) {
    return new Response('Unauthorized', {status: 401}); // Clear early return
  }

  if (user.suspended) {
    return new Response('Suspended', {status: 403}); // Clear early return
  }

  context.user = user;
  const response = yield request; // MUST yield to continue - no forgetting!
  return response;
}
```

With generators:
- **Impossible to forget continuation** - must `yield` to continue
- **Impossible to continue outside control flow** - generators are linear
- **Impossible to double-continue** - generators can only yield once per step

### 2. Clean Syntax with Powerful Semantics

Generator middleware provides intuitive syntax that maps directly to request/response flow:

```javascript
async function* middleware(request, context) {
  // Pre-processing: modify request, enrich context
  request.headers.set('X-Trace-ID', crypto.randomUUID());
  context.startTime = Date.now();

  // Yield = "continue processing this request"
  const response = yield request;

  // Post-processing: modify response, cleanup
  response.headers.set('X-Response-Time', Date.now() - context.startTime);
  return response;
}
```

The syntax naturally expresses the middleware pattern:
- **Setup phase** before `yield`
- **Continuation** via `yield request`
- **Cleanup phase** after `yield`
- **Early returns** for short-circuiting

### 3. Guaranteed Execution (Rack-Style Architecture)

Here's the revolutionary insight: **all middleware executes regardless of early returns**. This was solved in Ruby's Rack framework in 2007, yet JavaScript frameworks still don't have this capability due to the architectural limitations of `next()` callbacks.

#### Why `next()` Makes Guaranteed Execution Impossible
```javascript
// Express/Koa - architecturally impossible to guarantee execution
async function middleware1(ctx, next) {
  if (authFails) {
    return new Response('Unauthorized'); // KILLS entire downstream chain
  }

  await next(); // Contains ALL downstream middleware + handler
}

async function corsMiddleware(ctx, next) {
  // This NEVER runs if middleware1 returned early
  // because it was never invoked - it's inside the next() call
  ctx.headers['Access-Control-Allow-Origin'] = '*';
  await next();
}
```

When `middleware1` doesn't call `next()`, `corsMiddleware` **never even gets invoked**. The entire downstream execution is contained within that `next()` call.

#### Generator Architecture Enables Guaranteed Execution
```javascript
// Generator style - all middleware ALWAYS executes
async function* authMiddleware(request, context) {
  if (!request.headers.get('Authorization')) {
    return new Response('Unauthorized', {status: 401}); // Early return
  }

  context.user = await validateUser(request);
  const response = yield request;
  return response;
}

async function* corsMiddleware(request, context) {
  // This ALWAYS runs, even when auth returned 401 early
  const response = yield request; // Gets the 401 response
  response.headers.set('Access-Control-Allow-Origin', '*');
  return response;
}

async function* loggingMiddleware(request, context) {
  // This ALWAYS runs too - gets 401 + CORS headers
  const response = yield request;
  console.log(`${request.method} ${request.url} -> ${response.status}`);
  return response;
}
```

**Result**: 401 response with CORS headers and logged request - all middleware participated.

The framework **always calls all middleware functions**. Early returns just change what gets passed down the chain, but every middleware function still executes. This is architecturally impossible with `next()` callbacks but natural with generators.

#### Why This Matters
Cross-cutting concerns like CORS, logging, metrics, and security headers should apply to **all responses**, including error responses:

```javascript
// With guaranteed execution, security headers ALWAYS apply
async function* securityHeaders(request, context) {
  const response = yield request; // Might be 401, 500, 200, etc.

  // These headers apply to ALL responses
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Strict-Transport-Security', 'max-age=31536000');

  return response;
}
```

Rack solved this in 2007. It's 2024 and JavaScript frameworks still route around this fundamental limitation.

### 3. Simple Yield Rules
- **0 yields** = Early return (short-circuit with response)
- **1 yield** = Normal flow (process request and response)
- **Multiple yields** = Not supported (future feature)

## API Design

### Middleware Registration
```javascript
// Both function and generator middleware supported
router.use(functionMiddleware);     // Automatically detected
router.use(generatorMiddleware);    // Automatically detected

// Detection is automatic
function isMiddleware(func) {
  return func.constructor.name === 'AsyncGeneratorFunction';
}
```

### Function Middleware (Simple Cases)
```javascript
// Implicit passthrough - perfect for common cases
router.use(async function addHeaders(request, context) {
  request.headers.set('X-Request-ID', crypto.randomUUID());
  context.user = await getUser(request);
  // Implicit: yield request, return response
});

router.use(async function enrichContext(request, context) {
  context.startTime = Date.now();
  context.traceId = generateTraceId();
  // Implicit passthrough
});
```

### Generator Middleware (Full Control)
```javascript
// Early return capability
router.use(async function* authMiddleware(request, context) {
  const token = request.headers.get('Authorization');

  if (!token) {
    return new Response('Unauthorized', {status: 401}); // Early return
  }

  context.user = await validateUser(token);
  const response = yield request; // Continue chain
  response.headers.set('X-User-ID', context.user.id);
  return response;
});

// Passthrough with null/undefined return
router.use(async function* setupContext(request, context) {
  context.requestId = crypto.randomUUID();
  context.startTime = Date.now();
  return; // Same as: const response = yield request; return response;
});
```

## Execution Engine

### Guaranteed Execution Implementation
```javascript
async function executeMiddlewareStack(middlewares, request, context) {
  let currentResponse = null;

  // Execute ALL middleware in order, regardless of early returns
  for (const middleware of middlewares) {
    if (isGeneratorFunction(middleware)) {
      currentResponse = await executeGenerator(middleware, request, context, currentResponse);
    } else {
      currentResponse = await executeFunction(middleware, request, context, currentResponse);
    }
  }

  return currentResponse;
}

async function executeGenerator(middleware, request, context, currentResponse) {
  const generator = middleware(request, context);
  const result = await generator.next();

  if (result.done) {
    // Early return or passthrough
    return result.value ?? (currentResponse ?? await executeHandler(request, context));
  } else {
    // Middleware yielded - give it the current response
    const response = currentResponse ?? await executeHandler(request, context);
    const finalResult = await generator.next(response);
    return finalResult.value;
  }
}

async function executeFunction(middleware, request, context, currentResponse) {
  // Function middleware - implicit passthrough
  await middleware(request, context);
  return currentResponse ?? await executeHandler(request, context);
}
```

## Core Patterns

### 1. Authentication with Early Return
```javascript
async function* authMiddleware(request, context) {
  const token = request.headers.get('Authorization');

  if (!token) {
    return new Response('Unauthorized', {status: 401});
  }

  try {
    context.user = await validateToken(token);
  } catch (error) {
    return new Response('Invalid token', {status: 401});
  }

  const response = yield request;
  return response;
}
```

### 2. Request/Response Modification
```javascript
async function* addTracing(request, context) {
  // Modify request
  const traceId = crypto.randomUUID();
  request.headers.set('X-Trace-ID', traceId);
  context.traceId = traceId;

  const response = yield request;

  // Modify response
  response.headers.set('X-Trace-ID', traceId);
  response.headers.set('X-Request-Time', Date.now() - context.startTime);
  return response;
}
```

### 3. External Service Calls
```javascript
async function* dataEnrichment(request, context) {
  const userId = context.params.id;

  // Make external calls (not yielded - use regular fetch)
  const [profile, preferences] = await Promise.all([
    fetch(`/profile-service/users/${userId}`),
    fetch(`/preferences-service/users/${userId}`)
  ]);

  context.enrichedData = {
    profile: await profile.json(),
    preferences: await preferences.json()
  };

  const response = yield request;
  return response;
}
```

### 4. Smart Caching
```javascript
async function* cacheMiddleware(request, context) {
  const cacheKey = getCacheKey(request);

  // Try cache first
  const cached = await context.cache?.match(request);
  if (cached) {
    return cached; // Short-circuit with cached response
  }

  // Cache miss - continue to origin
  const response = yield request;

  // Cache for next time
  if (response.ok) {
    await context.cache?.put(request, response.clone());
  }

  return response;
}
```

### 5. Error Handling
```javascript
async function* errorHandler(request, context) {
  try {
    const response = yield request;
    return response;
  } catch (error) {
    // Log error to external service
    await fetch('/logs/error', {
      method: 'POST',
      body: JSON.stringify({
        error: error.message,
        url: request.url,
        traceId: context.traceId
      })
    });

    return new Response('Internal Server Error', {status: 500});
  }
}
```

### 6. Automatic Redirects via URL Modification
```javascript
async function* canonicalizeUrl(request, context) {
  // Remove trailing slash - framework handles redirect automatically
  if (request.url.endsWith('/') && request.url.length > 1) {
    request.url = request.url.slice(0, -1);
  }

  const response = yield request; // Framework returns 302 redirect automatically
  return response;
}

async function* httpsUpgrade(request, context) {
  // Protocol upgrades get 301 automatically
  if (request.url.startsWith('http://')) {
    request.url = request.url.replace('http://', 'https://');
  }

  const response = yield request; // Framework returns 301 for protocol changes
  return response;
}

async function* apiVersioning(request, context) {
  // Non-GET methods preserve method with 307
  if (!request.url.includes('/v2/')) {
    request.url = request.url.replace('/api/', '/api/v2/');
  }

  // Framework chooses:
  // - 307 for POST/PUT/etc (preserves method and body)
  // - 302 for GET (safe default)
  const response = yield request;
  return response;
}

async function* preciseRedirect(request, context) {
  // For complex cases, write the redirect response manually
  if (needsSpecialRedirect(request)) {
    return new Response(null, {
      status: 308, // Permanent redirect preserving method
      headers: {
        Location: buildComplexUrl(request),
        'Cache-Control': 'max-age=31536000'
      }
    });
  }

  const response = yield request;
  return response;
}
```

## Shared Context Pattern

Context flows through the entire request lifecycle and is shared between all middleware:

```javascript
async function* middleware1(request, context) {
  context.step1 = 'completed';
  context.startTime = Date.now();
  const response = yield request;
  context.duration = Date.now() - context.startTime;
  return response;
}

function middleware2(request, context) {
  // Can read context.step1, context.startTime
  context.step2 = 'completed';
  // Implicit passthrough
}

async function* middleware3(request, context) {
  // Can read all previous context
  const response = yield request;
  response.headers.set('X-Duration', context.duration.toString());
  return response;
}

async function handler(request, context) {
  // Handler has access to enriched context
  return new Response(`Steps: ${context.step1}, ${context.step2}`);
}
```

## Automatic Redirect Behavior

When middleware modifies `request.url`, the framework automatically handles redirects:

### Smart Status Code Selection
- **Protocol changes** (`http://` → `https://`): **301 Permanent**
- **Non-GET methods** (POST, PUT, etc.): **307 Temporary (preserves method)**
- **Everything else**: **302 Temporary**

### Security Enforcement
URL changes are restricted to same-origin only to prevent data leakage:

```javascript
async function* secureMiddleware(request, context) {
  // ✅ ALLOWED - same origin
  request.url = request.url.replace('/api/', '/api/v2/');

  // ❌ ERROR - different origin (security risk)
  request.url = 'https://evil.com/steal-data';

  const response = yield request;
  return response;
}
```

### Manual Override for Complex Cases
For precise control, write redirect responses manually:

```javascript
async function* complexRedirect(request, context) {
  if (needsSpecialHandling(request)) {
    return new Response(null, {
      status: 308, // Permanent redirect preserving method
      headers: {
        Location: buildSpecialUrl(request),
        'Cache-Control': 'max-age=31536000'
      }
    });
  }

  const response = yield request;
  return response;
}
```

## Benefits

### 1. Guaranteed Execution
Unlike Express-style middleware, all middleware executes regardless of early returns:

```javascript
// Express: CORS never runs if auth fails
app.use(authMiddleware);  // Returns 401, ends chain
app.use(corsMiddleware);  // NEVER RUNS

// Generators: CORS always runs
router.use(authMiddleware);  // Returns 401, but chain continues
router.use(corsMiddleware);  // ALWAYS RUNS, adds CORS to 401
```

### 2. Syntactic Safety
- **Impossible to forget yield** - middleware won't continue without it
- **Impossible to yield outside control flow** - generators are linear
- **TypeScript enforces correct patterns** - compile-time safety

### 3. Clean Error Handling
- Framework can inject errors at yield points using `generator.throw()`
- Middleware uses natural try/catch patterns
- No complex error callback chains

### 4. Natural Async Patterns
```javascript
async function* middleware(request, context) {
  // Standard async/await patterns work naturally
  const [a, b, c] = await Promise.all([
    fetch('/service-a'),
    fetch('/service-b'),
    fetch('/service-c')
  ]);

  context.data = { a, b, c };
  const response = yield request;
  return response;
}
```

### 5. Flexible Control Flow
- Early returns for short-circuiting
- Explicit yields for response processing
- Passthrough sugar with `null`/`undefined` returns

## Type Definitions

```typescript
type GeneratorMiddleware = (
  request: Request,
  context: RouteContext
) => AsyncGenerator<Request, Response | null | undefined, Response>;

type FunctionMiddleware = (
  request: Request,
  context: RouteContext
) => void | Promise<void>;

type Handler = (
  request: Request,
  context: RouteContext
) => Response | Promise<Response>;

interface RouteContext {
  params: Record<string, string>;
  cache?: Cache;
  caches?: CacheStorage;
  [key: string]: any; // Middleware can add arbitrary properties
}
```

## Migration Guide

### From Express-style Middleware
```javascript
// Before (Express-style)
async function authMiddleware(request, context, next) {
  const user = await validateAuth(request);
  if (!user) {
    return new Response('Unauthorized', {status: 401}); // Breaks chain
  }
  context.user = user;
  const response = await next();
  return response;
}

// After (Generator-style)
async function* authMiddleware(request, context) {
  const user = await validateAuth(request);
  if (!user) {
    return new Response('Unauthorized', {status: 401}); // Chain continues
  }
  context.user = user;
  const response = yield request;
  return response;
}
```

### Simple Middleware
```javascript
// Before
async function addHeaders(request, context, next) {
  request.headers.set('X-Request-ID', crypto.randomUUID());
  return next();
}

// After (Function middleware)
async function addHeaders(request, context) {
  request.headers.set('X-Request-ID', crypto.randomUUID());
  // Implicit passthrough
}
```

## Comparison with Other Systems

| Feature | Express | Koa | Rack/WSGI | Generators |
|---------|---------|-----|-----------|------------|
| Guaranteed Execution | ❌ | ❌ | ✅ | ✅ |
| Syntax Safety | ❌ | ❌ | ✅ | ✅ |
| Early Returns | ✅ | ✅ | ✅ | ✅ |
| Response Mutation | ❌ | ✅ | ✅ | ✅ |
| Simple Syntax | ✅ | ❌ | ❌ | ✅ |

## Future Extensions

While the current design limits middleware to 0 or 1 yields, future versions could support multiple yields for advanced patterns:

- **Retry logic** - yield multiple times on failures
- **Circuit breakers** - yield to fallback services
- **A/B testing** - yield to different endpoints
- **Progressive enhancement** - yield to multiple API versions

The 0/1 yield limitation provides a solid foundation while keeping the mental model simple.

## Conclusion

Generator-based middleware combines the order independence of Rack/WSGI with the clean syntax of modern JavaScript. It eliminates entire classes of bugs while providing powerful patterns for building resilient web applications. The dual support for function and generator middleware gives developers the right tool for each situation - simple functions for common cases, generators for complex control flow.

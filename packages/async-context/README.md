# @b9g/async-context

Lightweight polyfill for the [TC39 AsyncContext proposal](https://github.com/tc39/proposal-async-context) using Node.js `AsyncLocalStorage`.

## Why This Package?

The TC39 AsyncContext proposal aims to standardize async context propagation in JavaScript. However:

- The proposal is still Stage 2 (not yet standardized)
- No native browser/runtime support yet
- Node.js already has `AsyncLocalStorage` which solves the same problem

This package provides a **lightweight, maintainable polyfill** that:

✅ Implements the TC39 `AsyncContext.Variable` and `AsyncContext.Snapshot` APIs
✅ Uses battle-tested `AsyncLocalStorage` under the hood
✅ Zero dependencies (beyond Node.js built-ins)
✅ Full TypeScript support
✅ Production-ready and well-tested

## Installation

```bash
npm install @b9g/async-context
# or
bun add @b9g/async-context
```

## Usage

### Basic Example

```typescript
import { AsyncContext } from "@b9g/async-context";

// Create a context variable
const userContext = new AsyncContext.Variable<User>();

// Set a value that propagates through async operations
userContext.run(currentUser, async () => {
  await someAsyncOperation();

  const user = userContext.get(); // returns currentUser
  console.log(user.name);
});
```

### Request Context (Web Server)

```typescript
import { AsyncVariable } from "@b9g/async-context";

interface RequestContext {
  requestId: string;
  userId?: string;
  startTime: number;
}

const requestContext = new AsyncVariable<RequestContext>();

// In your request handler
async function handleRequest(request: Request) {
  return requestContext.run(
    {
      requestId: crypto.randomUUID(),
      userId: await getUserId(request),
      startTime: Date.now(),
    },
    async () => {
      // Context is available throughout the async call chain
      await authenticate();
      const result = await processRequest();
      await logMetrics();
      return result;
    }
  );
}

function logMetrics() {
  const ctx = requestContext.get();
  const duration = Date.now() - ctx.startTime;
  console.log(`Request ${ctx.requestId} took ${duration}ms`);
}
```

### Multiple Independent Contexts

```typescript
const userContext = new AsyncVariable<User>();
const tenantContext = new AsyncVariable<Tenant>();

userContext.run(user, () => {
  tenantContext.run(tenant, async () => {
    // Both contexts are available
    const currentUser = userContext.get();
    const currentTenant = tenantContext.get();

    await doWork(currentUser, currentTenant);
  });
});
```

### Default Values

```typescript
const themeContext = new AsyncVariable<string>({
  defaultValue: "light"
});

console.log(themeContext.get()); // "light"

themeContext.run("dark", () => {
  console.log(themeContext.get()); // "dark"
});

console.log(themeContext.get()); // "light"
```

## Exports

### Classes

- `AsyncVariable<T>` - Main class for creating async context variables
- `AsyncSnapshot` - Captures and restores context state
- `AsyncContext.Variable<T>` - Alias for AsyncVariable (TC39 API)
- `AsyncContext.Snapshot` - Alias for AsyncSnapshot (TC39 API)

### Types

- `AsyncVariableOptions<T>` - Options for AsyncVariable constructor (defaultValue, name)

### Default Export

- `AsyncContext` - Object containing Variable and Snapshot classes

## API

### `AsyncVariable<T>`

Main class for creating async context variables.

#### `constructor(options?: AsyncVariableOptions<T>)`

Options:
- `defaultValue?: T` - Default value when no context is set
- `name?: string` - Optional name for debugging

#### `run<R>(value: T, fn: (...args) => R, ...args): R`

Execute a function with a context value. The value is available via `get()` throughout the entire async execution of `fn`.

**Parameters:**
- `value: T` - The context value to set
- `fn: (...args) => R` - Function to execute (can be sync or async)
- `...args` - Additional arguments to pass to fn

**Returns:** The return value of `fn`

#### `get(): T | undefined`

Get the current context value. Returns `defaultValue` if no context is set.

#### `name: string | undefined`

Get the name of this variable (for debugging).

### `AsyncSnapshot`

Captures the current values of all Variables at construction time. Use `run()` to restore that state later.

#### `constructor()`

Creates a snapshot of all current Variable values.

#### `run<R>(fn: (...args) => R, ...args): R`

Execute a function with the captured context values restored.

**Parameters:**
- `fn: (...args) => R` - Function to execute
- `...args` - Additional arguments to pass to fn

**Returns:** The return value of `fn`

#### `static wrap<F>(fn: F): F`

Wrap a function to preserve the current context. When the wrapped function is called later, it will execute with the context values that were active when `wrap()` was called.

```typescript
const userVar = new AsyncContext.Variable<string>();

const wrappedFn = userVar.run("alice", () => {
  return AsyncContext.Snapshot.wrap(() => {
    return userVar.get();
  });
});

// Later, even outside the run() context:
wrappedFn(); // returns "alice"
```

## How It Works

This polyfill wraps Node.js's `AsyncLocalStorage` to provide the TC39 AsyncContext API:

```typescript
// AsyncContext API (this polyfill)
const ctx = new AsyncContext.Variable<number>();
ctx.run(42, () => {
  console.log(ctx.get()); // 42
});

// AsyncLocalStorage (Node.js native)
const storage = new AsyncLocalStorage<number>();
storage.run(42, () => {
  console.log(storage.getStore()); // 42
});
```

The polyfill provides:
- Cleaner API matching the future standard
- Default value support
- Better TypeScript types
- Future-proof (easy migration when AsyncContext lands in browsers)

## Runtime Support

This package works in any JavaScript runtime that supports `AsyncLocalStorage`:

- ✅ Node.js 12.17+
- ✅ Bun
- ✅ Deno
- ✅ Cloudflare Workers

## Differences from TC39 Proposal

This polyfill implements the core TC39 AsyncContext API:

- ✅ `AsyncContext.Variable` - context variables with `run()` and `get()`
- ✅ `AsyncContext.Snapshot` - context capture with `run()` and `wrap()`

The implementation uses Node.js `AsyncLocalStorage` rather than the pure-JS reference implementation, which means async context propagation works natively without monkey-patching `Promise.prototype.then`.

Test suite adapted from the [TC39 proposal repository](https://github.com/tc39/proposal-async-context).

## Migration Path

### From `AsyncLocalStorage`

```typescript
// Before
import { AsyncLocalStorage } from "node:async_hooks";
const storage = new AsyncLocalStorage<User>();

storage.run(user, () => {
  const current = storage.getStore();
});

// After
import { AsyncVariable } from "@b9g/async-context";
const userContext = new AsyncVariable<User>();

userContext.run(user, () => {
  const current = userContext.get();
});
```

## License

MIT

## See Also

- [TC39 AsyncContext Proposal](https://github.com/tc39/proposal-async-context)
- [Node.js AsyncLocalStorage](https://nodejs.org/api/async_context.html#class-asynclocalstorage)
- [Shovel Framework](https://github.com/b9g/shovel)

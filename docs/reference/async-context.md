# @b9g/async-context

[TC39 AsyncContext proposal](https://github.com/tc39/proposal-async-context) implementation for request-scoped state.

---

## AsyncContext.Variable\<T\>

Stores a value that propagates through async operations.

### Constructor

```typescript
new AsyncContext.Variable<T>(options?: {
  defaultValue?: T;
  name?: string;
})
```

### run\<R\>(value: T, fn: () => R): R

Executes a function with the variable set.

```typescript
const user = new AsyncContext.Variable<User>();

user.run({ id: 1 }, () => {
  console.log(user.get()); // { id: 1 }
});
```

### get(): T | undefined

Gets the current value.

```typescript
const current = user.get();
```

---

## AsyncContext.Snapshot

Captures and restores all variable values.

### Constructor

```typescript
const snapshot = new AsyncContext.Snapshot();
```

### run\<R\>(fn: () => R): R

Executes with captured values restored.

```typescript
let snapshot: AsyncContext.Snapshot;

requestId.run("req-123", () => {
  snapshot = new AsyncContext.Snapshot();
});

snapshot.run(() => {
  console.log(requestId.get()); // "req-123"
});
```

### static wrap\<T\>(fn: T): T

Wraps a function to run with current context.

```typescript
requestId.run("req-123", () => {
  const wrapped = AsyncContext.Snapshot.wrap(() => {
    console.log(requestId.get());
  });
  setTimeout(wrapped, 100); // Logs "req-123"
});
```

---

## Nesting

Inner `run()` calls shadow outer values:

```typescript
level.run(1, () => {
  console.log(level.get()); // 1
  level.run(2, () => {
    console.log(level.get()); // 2
  });
  console.log(level.get()); // 1
});
```

---

## Shovel Built-in Contexts

| Global | Description |
|--------|-------------|
| `cookieStore` | Request-scoped cookie access |

---

## See Also

- [Cookies](./cookies.md) - Request-scoped cookies
- [ServiceWorker](./serviceworker.md) - Request handling


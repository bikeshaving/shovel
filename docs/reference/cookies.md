# @b9g/cookies

[CookieStore API](https://developer.mozilla.org/en-US/docs/Web/API/CookieStore) implementation for servers.

---

## CookieStore

Global `cookieStore` available in ServiceWorker code.

### get(name: string): Promise\<CookieListItem | null\>

Gets a cookie by name.

```typescript
const cookie = await cookieStore.get("session");
if (cookie) {
  console.log(cookie.value);
}
```

### get(options: CookieStoreGetOptions): Promise\<CookieListItem | null\>

Gets a cookie with options.

```typescript
const cookie = await cookieStore.get({
  name: "session",
  url: "https://example.com",
});
```

### getAll(): Promise\<CookieListItem[]\>

Gets all cookies.

```typescript
const cookies = await cookieStore.getAll();
```

### getAll(name: string): Promise\<CookieListItem[]\>

Gets all cookies with a specific name.

### getAll(options: CookieStoreGetOptions): Promise\<CookieListItem[]\>

Gets cookies matching options.

### set(name: string, value: string): Promise\<void\>

Sets a cookie with defaults.

```typescript
await cookieStore.set("session", "abc123");
```

### set(options: CookieInit): Promise\<void\>

Sets a cookie with options.

```typescript
await cookieStore.set({
  name: "session",
  value: "abc123",
  expires: Date.now() + 86400000,
  sameSite: "lax",
});
```

### delete(name: string): Promise\<void\>

Deletes a cookie.

```typescript
await cookieStore.delete("session");
```

### delete(options: CookieStoreDeleteOptions): Promise\<void\>

Deletes a cookie with options.

```typescript
await cookieStore.delete({
  name: "session",
  domain: "example.com",
  path: "/",
});
```

---

## CookieInit

| Field | Type | Default |
|-------|------|---------|
| `name` | `string` | Required |
| `value` | `string` | Required |
| `domain` | `string` | Current domain |
| `path` | `string` | `/` |
| `expires` | `number` | Session |
| `secure` | `boolean` | `true` |
| `sameSite` | `"strict" \| "lax" \| "none"` | `"strict"` |
| `partitioned` | `boolean` | `false` |

---

## CookieListItem

```typescript
interface CookieListItem {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  secure?: boolean;
  sameSite?: "strict" | "lax" | "none";
  partitioned?: boolean;
}
```

---

## Request Isolation

Each request gets its own cookie store via [AsyncContext](./async-context.md). Changes are applied as `Set-Cookie` headers on the response.

---

## Limitations

- No `httpOnly` support (use server-side sessions for sensitive tokens)
- No `change` events

---

## See Also

- [AsyncContext](./async-context.md) - Request isolation
- [ServiceWorker](./serviceworker.md) - Request handling


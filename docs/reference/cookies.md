# Cookies

Shovel provides the [CookieStore API](https://developer.mozilla.org/en-US/docs/Web/API/CookieStore) for reading and writing cookies. The `cookieStore` global is available in your ServiceWorker code.

## Quick Start

```typescript
self.addEventListener("fetch", async (event) => {
  // Read a cookie
  const session = await cookieStore.get("session");

  if (!session) {
    // Set a cookie
    await cookieStore.set("session", crypto.randomUUID());
  }

  event.respondWith(new Response("OK"));
});
```

---

## Reading Cookies

### cookieStore.get(name)

Gets a single cookie by name.

```typescript
const cookie = await cookieStore.get("session");

if (cookie) {
  console.log(cookie.name);   // "session"
  console.log(cookie.value);  // "abc123"
}
```

Returns `null` if the cookie doesn't exist.

### cookieStore.get(options)

Gets a cookie with options.

```typescript
const cookie = await cookieStore.get({
  name: "session",
  url: "https://example.com",
});
```

### cookieStore.getAll()

Gets all cookies.

```typescript
const cookies = await cookieStore.getAll();

for (const cookie of cookies) {
  console.log(`${cookie.name}=${cookie.value}`);
}
```

### cookieStore.getAll(name)

Gets all cookies with a specific name.

```typescript
const sessions = await cookieStore.getAll("session");
```

### cookieStore.getAll(options)

Gets cookies matching options.

```typescript
const cookies = await cookieStore.getAll({
  name: "prefs",
  url: "https://example.com",
});
```

---

## Writing Cookies

### cookieStore.set(name, value)

Sets a cookie with default options.

```typescript
await cookieStore.set("session", "abc123");
```

Default options:
- `path`: `/`
- `sameSite`: `strict`
- `secure`: `true`

### cookieStore.set(options)

Sets a cookie with full options.

```typescript
await cookieStore.set({
  name: "session",
  value: "abc123",
  domain: "example.com",
  path: "/",
  expires: Date.now() + 86400000, // 1 day
  secure: true,
  sameSite: "lax",
});
```

### Cookie Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | Required | Cookie name |
| `value` | `string` | Required | Cookie value |
| `domain` | `string` | Current domain | Cookie domain |
| `path` | `string` | `/` | Cookie path |
| `expires` | `number` | Session | Expiration timestamp (ms) |
| `secure` | `boolean` | `true` | HTTPS only |
| `sameSite` | `"strict" \| "lax" \| "none"` | `"strict"` | SameSite policy |
| `partitioned` | `boolean` | `false` | Partitioned cookie (CHIPS) |

---

## Deleting Cookies

### cookieStore.delete(name)

Deletes a cookie by name.

```typescript
await cookieStore.delete("session");
```

### cookieStore.delete(options)

Deletes a cookie with options.

```typescript
await cookieStore.delete({
  name: "session",
  domain: "example.com",
  path: "/",
});
```

---

## Cookie Object

Cookies returned by `get` and `getAll` have this structure:

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

Each request gets its own cookie store via [AsyncContext](./async-context.md). Cookie changes in one request don't affect other concurrent requests.

```typescript
self.addEventListener("fetch", async (event) => {
  // This request's cookieStore is isolated
  await cookieStore.set("requestId", crypto.randomUUID());

  // Won't interfere with other concurrent requests
  event.respondWith(new Response("OK"));
});
```

---

## Response Headers

Cookie changes are automatically applied to the response as `Set-Cookie` headers:

```typescript
self.addEventListener("fetch", async (event) => {
  await cookieStore.set("session", "abc123");
  await cookieStore.delete("old-cookie");

  event.respondWith(new Response("OK"));
  // Response includes:
  // Set-Cookie: session=abc123; Path=/; SameSite=Strict; Secure
  // Set-Cookie: old-cookie=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT
});
```

---

## Common Patterns

### Session Management

```typescript
async function getSession(request: Request) {
  const sessionId = (await cookieStore.get("session"))?.value;

  if (!sessionId) {
    return null;
  }

  const db = databases.get("main");
  return db.get`SELECT * FROM sessions WHERE id = ${sessionId}`;
}

async function createSession(userId: string) {
  const sessionId = crypto.randomUUID();
  const db = databases.get("main");

  await db.exec`
    INSERT INTO sessions (id, user_id, created_at)
    VALUES (${sessionId}, ${userId}, ${Date.now()})
  `;

  await cookieStore.set({
    name: "session",
    value: sessionId,
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: "lax",
  });

  return sessionId;
}

async function destroySession() {
  const sessionId = (await cookieStore.get("session"))?.value;

  if (sessionId) {
    const db = databases.get("main");
    await db.exec`DELETE FROM sessions WHERE id = ${sessionId}`;
  }

  await cookieStore.delete("session");
}
```

### Authentication Middleware

```typescript
const authMiddleware = async (request: Request, context: RouteContext) => {
  const session = await getSession(request);

  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  context.session = session;
  context.user = await getUser(session.user_id);

  return null; // Continue to next middleware
};

router.use("/api", authMiddleware);
```

### Remember Me

```typescript
async function login(userId: string, rememberMe: boolean) {
  const sessionId = crypto.randomUUID();

  await cookieStore.set({
    name: "session",
    value: sessionId,
    expires: rememberMe
      ? Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days
      : undefined, // Session cookie
    sameSite: "lax",
  });
}
```

### Cookie Consent

```typescript
async function hasConsent(): Promise<boolean> {
  const consent = await cookieStore.get("cookie-consent");
  return consent?.value === "accepted";
}

async function setConsent(accepted: boolean) {
  await cookieStore.set({
    name: "cookie-consent",
    value: accepted ? "accepted" : "rejected",
    expires: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year
    sameSite: "lax",
  });
}
```

### Secure Token Storage

```typescript
async function setAuthToken(token: string) {
  await cookieStore.set({
    name: "auth-token",
    value: token,
    secure: true,
    sameSite: "strict",
    // httpOnly is not available in CookieStore API
    // For sensitive tokens, consider server-side sessions
  });
}
```

---

## Limitations

### No httpOnly Support

The CookieStore API doesn't support `httpOnly` cookies. For security-sensitive tokens, use server-side sessions with a non-sensitive session ID in the cookie.

### No Cookie Events

Browser CookieStore supports `change` events, but server-side usage doesn't emit events.

---

## See Also

- [AsyncContext](./async-context.md) - Request isolation
- [ServiceWorker](./serviceworker.md) - Request handling
- [Middleware](./middleware.md) - Authentication patterns

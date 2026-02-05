# @b9g/http-errors

HTTP error classes for consistent error handling.

---

## HTTPError

Base class for all HTTP errors.

### Constructor

```typescript
new HTTPError(status: number, message?: string, options?: HTTPErrorOptions)
```

### HTTPErrorOptions

```typescript
interface HTTPErrorOptions {
  cause?: Error;
  headers?: Record<string, string>;
  expose?: boolean;
}
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `status` | `number` | HTTP status code |
| `statusCode` | `number` | Alias for `status` |
| `message` | `string` | Error message |
| `expose` | `boolean` | Expose message to clients |
| `headers` | `Record<string, string>` | Custom headers |
| `cause` | `Error` | Original error |

### toJSON(): object

Serializes the error.

```typescript
error.toJSON();
// { name, message, status, statusCode, expose }
```

### toResponse(isDev?: boolean): Response

Converts to HTTP Response.

```typescript
error.toResponse();      // Plain text
error.toResponse(true);  // HTML with stack trace
```

---

## Client Errors (4xx)

| Class | Status | Default Message |
|-------|--------|-----------------|
| `BadRequest` | 400 | Bad Request |
| `Unauthorized` | 401 | Unauthorized |
| `Forbidden` | 403 | Forbidden |
| `NotFound` | 404 | Not Found |
| `MethodNotAllowed` | 405 | Method Not Allowed |
| `Conflict` | 409 | Conflict |
| `UnprocessableEntity` | 422 | Unprocessable Entity |
| `TooManyRequests` | 429 | Too Many Requests |

---

## Server Errors (5xx)

| Class | Status | Default Message |
|-------|--------|-----------------|
| `InternalServerError` | 500 | Internal Server Error |
| `NotImplemented` | 501 | Not Implemented |
| `BadGateway` | 502 | Bad Gateway |
| `ServiceUnavailable` | 503 | Service Unavailable |
| `GatewayTimeout` | 504 | Gateway Timeout |

---

## isHTTPError(value: unknown): value is HTTPError

Type guard for HTTP errors.

```typescript
if (isHTTPError(error)) {
  console.log(error.status);
}
```

---

## Usage

```typescript
import { NotFound, BadRequest } from "@b9g/http-errors";

throw new NotFound("User not found");

throw new BadRequest("Invalid email", {
  headers: { "X-Error-Code": "INVALID_EMAIL" },
});
```

---

## Exposure

4xx errors expose messages by default; 5xx errors don't.

```typescript
throw new BadRequest("Invalid input");  // Exposed
throw new InternalServerError("DB failed");  // Hidden

throw new InternalServerError("Overloaded", { expose: true });  // Override
```

---

## See Also

- [Middleware](./middleware.md) - Error handling
- [Router](./router.md) - Route handlers


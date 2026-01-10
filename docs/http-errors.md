# HTTP Errors

Shovel provides HTTP error classes for consistent error handling. These errors can be thrown and automatically converted to HTTP responses.

## Quick Start

```typescript
import { NotFound, BadRequest } from "@b9g/http-errors";

router.route("/users/:id").get(async (request, context) => {
  const user = await getUser(context.params.id);

  if (!user) {
    throw new NotFound("User not found");
  }

  return Response.json(user);
});
```

---

## HTTPError Class

The base class for all HTTP errors.

### Constructor

```typescript
new HTTPError(status: number, message?: string, options?: HTTPErrorOptions)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | `number` | HTTP status code |
| `message` | `string` | Error message (defaults to status text) |
| `options` | `HTTPErrorOptions` | Additional options |

### Options

```typescript
interface HTTPErrorOptions {
  cause?: Error;                    // Original error
  headers?: Record<string, string>; // Custom response headers
  expose?: boolean;                 // Expose message to client
}
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `status` | `number` | HTTP status code |
| `statusCode` | `number` | Alias for `status` |
| `message` | `string` | Error message |
| `expose` | `boolean` | Whether to expose message to clients |
| `headers` | `Record<string, string>` | Custom headers |
| `cause` | `Error` | Original error (if any) |

### Methods

#### toJSON()

Serialize the error for JSON responses:

```typescript
const error = new NotFound("User not found");
console.log(error.toJSON());
// {
//   name: "NotFound",
//   message: "User not found",
//   status: 404,
//   statusCode: 404,
//   expose: true
// }
```

#### toResponse(isDev?)

Convert to an HTTP Response:

```typescript
const error = new NotFound("User not found");

// Production: plain text response
const response = error.toResponse();

// Development: HTML page with stack trace
const devResponse = error.toResponse(true);
```

---

## Error Classes

### Client Errors (4xx)

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

### Server Errors (5xx)

| Class | Status | Default Message |
|-------|--------|-----------------|
| `InternalServerError` | 500 | Internal Server Error |
| `NotImplemented` | 501 | Not Implemented |
| `BadGateway` | 502 | Bad Gateway |
| `ServiceUnavailable` | 503 | Service Unavailable |
| `GatewayTimeout` | 504 | Gateway Timeout |

---

## Usage Examples

### Basic Usage

```typescript
import { NotFound, BadRequest, Unauthorized } from "@b9g/http-errors";

// Simple error
throw new NotFound();

// With message
throw new NotFound("User not found");

// With options
throw new BadRequest("Invalid email format", {
  headers: { "X-Error-Code": "INVALID_EMAIL" },
});
```

### Error Cause Chain

Preserve the original error:

```typescript
import { InternalServerError } from "@b9g/http-errors";

try {
  await database.query(sql);
} catch (error) {
  throw new InternalServerError("Database query failed", {
    cause: error,
  });
}
```

### Custom Headers

Add response headers:

```typescript
import { Unauthorized, TooManyRequests } from "@b9g/http-errors";

// WWW-Authenticate header
throw new Unauthorized("Invalid token", {
  headers: { "WWW-Authenticate": "Bearer" },
});

// Rate limit headers
throw new TooManyRequests("Rate limit exceeded", {
  headers: {
    "Retry-After": "60",
    "X-RateLimit-Remaining": "0",
  },
});
```

### Controlling Exposure

By default, 4xx errors expose their message, 5xx errors don't:

```typescript
import { BadRequest, InternalServerError } from "@b9g/http-errors";

// Message exposed to client (default for 4xx)
throw new BadRequest("Invalid input");

// Message hidden from client (default for 5xx)
throw new InternalServerError("Database connection failed");

// Override defaults
throw new InternalServerError("Server overloaded", {
  expose: true, // Show message to client
});
```

---

## Error Handling Middleware

Handle errors with generator middleware:

```typescript
import { isHTTPError, InternalServerError } from "@b9g/http-errors";

const errorHandler = async function* (request: Request) {
  try {
    const response = yield request;
    return response;
  } catch (error) {
    if (isHTTPError(error)) {
      return error.toResponse(import.meta.env.DEV);
    }

    // Wrap unknown errors
    const httpError = new InternalServerError("An error occurred", {
      cause: error,
    });
    return httpError.toResponse(import.meta.env.DEV);
  }
};

router.use(errorHandler);
```

### JSON Error Responses

Return JSON instead of plain text:

```typescript
import { isHTTPError, InternalServerError } from "@b9g/http-errors";

const jsonErrorHandler = async function* (request: Request) {
  try {
    const response = yield request;
    return response;
  } catch (error) {
    const httpError = isHTTPError(error)
      ? error
      : new InternalServerError("An error occurred", { cause: error });

    return Response.json(
      {
        error: httpError.expose ? httpError.message : "Internal Server Error",
        status: httpError.status,
      },
      {
        status: httpError.status,
        headers: httpError.headers,
      }
    );
  }
};
```

---

## Type Guard

Check if a value is an HTTP error:

```typescript
import { isHTTPError } from "@b9g/http-errors";

try {
  await doSomething();
} catch (error) {
  if (isHTTPError(error)) {
    console.log(error.status); // Type-safe access
  }
}
```

---

## Custom Error Classes

Extend `HTTPError` for domain-specific errors:

```typescript
import { HTTPError } from "@b9g/http-errors";

class ValidationError extends HTTPError {
  readonly fields: Record<string, string>;

  constructor(fields: Record<string, string>) {
    super(422, "Validation failed");
    this.fields = fields;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      fields: this.fields,
    };
  }
}

// Usage
throw new ValidationError({
  email: "Invalid email format",
  password: "Must be at least 8 characters",
});
```

---

## Development Mode

In development mode, `toResponse(true)` returns an HTML page with:

- Colored status header (orange for 4xx, red for 5xx)
- Error message
- Full stack trace

```typescript
const error = new NotFound("User not found");
const response = error.toResponse(true);
// Returns HTML with formatted error page
```

In production mode, `toResponse()` returns plain text with minimal information.

---

## Common Patterns

### Route Not Found

```typescript
router.route("/*").get(() => {
  throw new NotFound();
});
```

### Authentication Required

```typescript
const authMiddleware = async (request, context) => {
  const token = request.headers.get("Authorization");

  if (!token) {
    throw new Unauthorized("Authentication required", {
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  try {
    context.user = await verifyToken(token);
  } catch {
    throw new Unauthorized("Invalid token");
  }

  return null;
};
```

### Input Validation

```typescript
router.route("/users").post(async (request) => {
  const body = await request.json();

  if (!body.email) {
    throw new BadRequest("Email is required");
  }

  if (!isValidEmail(body.email)) {
    throw new UnprocessableEntity("Invalid email format");
  }

  // Create user...
});
```

### Resource Conflicts

```typescript
router.route("/users").post(async (request) => {
  const body = await request.json();

  const existing = await getUserByEmail(body.email);
  if (existing) {
    throw new Conflict("User with this email already exists");
  }

  // Create user...
});
```

---

## See Also

- [Middleware](./middleware.md) - Error handling patterns
- [Routing](./routing.md) - Route handlers
- [ServiceWorker](./serviceworker.md) - Request handling

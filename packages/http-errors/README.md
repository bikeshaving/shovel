# @b9g/http-errors
**Standard HTTP error classes with native cause support and automatic serialization**

## Features

- **Universal**: Works in browsers, Node.js, Bun, and edge platforms
- **Response Protocol**: Implements `toResponse()` for automatic HTTP response conversion
- **Structured Logging**: Built-in `toJSON()` for clean error serialization
- **Standard HTTP Status Codes**: Pre-defined classes for all common HTTP errors
- **TypeScript Support**: Full type definitions for all error classes
- **Error Chaining**: Native `cause` support for error context

## Installation

```bash
npm install @b9g/http-errors
```

## Quick Start

```javascript
import {
  NotFound,
  BadRequest,
  Unauthorized,
  InternalServerError
} from '@b9g/http-errors';

// Throw as exceptions
throw new NotFound('Page not found');
throw new BadRequest('Invalid input data');

// Or convert to Response objects
const error = new NotFound('Page not found');
return error.toResponse(); // Response with status 404

// In development, get detailed error pages
return error.toResponse(true); // HTML page with stack trace
```

## API

### HTTPError Class

Base class for all HTTP errors. Extends `Error`.

```javascript
import { HTTPError } from '@b9g/http-errors';

const error = new HTTPError(404, 'Resource not found', {
  cause: originalError,        // Error that caused this
  headers: {                    // Custom headers for response
    'Cache-Control': 'no-store'
  },
  expose: true                  // Whether to expose message to client
});

error.status;        // 404
error.message;       // 'Resource not found'
error.expose;        // true (client errors default to true, server errors to false)
error.headers;       // { 'Cache-Control': 'no-store' }
```

### Methods

#### `toResponse(isDev?: boolean): Response`

Converts the error to an HTTP Response object.

- In development mode (`isDev = true`): Returns HTML page with stack trace
- In production mode: Returns plain text with minimal information

```javascript
const error = new NotFound('Page not found');

// Production response
error.toResponse();      // Response { status: 404, body: 'Page not found' }

// Development response with stack trace
error.toResponse(true);  // Response { status: 404, body: '<html>...</html>' }
```

#### `toJSON(): object`

Converts the error to a plain object for logging and serialization.

```javascript
const error = new BadRequest('Invalid email', {
  headers: { 'X-Custom': 'value' }
});

JSON.stringify(error);
// {
//   "name": "BadRequest",
//   "message": "Invalid email",
//   "status": 400,
//   "statusCode": 400,
//   "expose": true,
//   "headers": { "X-Custom": "value" }
// }

### Client Error Classes (4xx)

```javascript
import {
  BadRequest,           // 400
  Unauthorized,         // 401
  Forbidden,            // 403
  NotFound,             // 404
  MethodNotAllowed,     // 405
  Conflict,             // 409
  UnprocessableEntity,  // 422
  TooManyRequests       // 429
} from '@b9g/http-errors';

// All accept message and options
throw new Unauthorized('Invalid credentials', {
  headers: { 'WWW-Authenticate': 'Bearer realm="api"' }
});

throw new TooManyRequests('Rate limit exceeded', {
  headers: { 'Retry-After': '60' }
});
```

### Server Error Classes (5xx)

```javascript
import {
  InternalServerError,  // 500
  NotImplemented,       // 501
  BadGateway,           // 502
  ServiceUnavailable,   // 503
  GatewayTimeout        // 504
} from '@b9g/http-errors';

// Server errors default to expose: false
throw new InternalServerError('Database connection failed', {
  cause: dbError  // Chain the original error
});
```

### Functions

#### `isHTTPError(value): value is HTTPError`

Type guard to check if a value is an HTTPError.

```javascript
import {isHTTPError} from '@b9g/http-errors';

try {
  // ...
} catch (err) {
  if (isHTTPError(err)) {
    return err.toResponse();
  }
  throw err;
}
```

### Types

```typescript
interface HTTPErrorOptions {
  /** Original error that caused this HTTP error */
  cause?: Error;
  /** Custom headers to include in the error response */
  headers?: Record<string, string>;
  /** Whether error details should be exposed to clients (defaults based on status) */
  expose?: boolean;
  /** Additional properties to attach to the error */
  [key: string]: any;
}
```

## License

MIT

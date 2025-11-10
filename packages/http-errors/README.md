# @b9g/http-errors

Standard HTTP error responses with proper status codes and web platform Response objects.

## Features

- **Standard HTTP Errors**: Pre-defined error classes for common HTTP status codes
- **Web Platform Response**: Returns proper Response objects, not thrown exceptions
- **Consistent API**: Uniform interface across all error types
- **TypeScript Support**: Full type definitions for all error classes
- **Lightweight**: Minimal dependencies, works everywhere

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

// Create error responses
const notFound = NotFound('Page not found');
const badRequest = BadRequest('Invalid input data');
const unauthorized = Unauthorized('Authentication required');
const serverError = InternalServerError('Database connection failed');

// All return Response objects
console.log(notFound instanceof Response); // true
console.log(notFound.status); // 404
```

## Available Error Classes

### Client Errors (4xx)

```javascript
import {
  BadRequest,           // 400
  Unauthorized,         // 401
  PaymentRequired,      // 402
  Forbidden,           // 403
  NotFound,            // 404
  MethodNotAllowed,    // 405
  NotAcceptable,       // 406
  RequestTimeout,      // 408
  Conflict,            // 409
  Gone,                // 410
  LengthRequired,      // 411
  PreconditionFailed,  // 412
  PayloadTooLarge,     // 413
  URITooLong,          // 414
  UnsupportedMediaType, // 415
  RangeNotSatisfiable, // 416
  ExpectationFailed,   // 417
  ImATeapot,           // 418
  UnprocessableEntity, // 422
  TooManyRequests,     // 429
} from '@b9g/http-errors';
```

### Server Errors (5xx)

```javascript
import {
  InternalServerError, // 500
  NotImplemented,      // 501
  BadGateway,          // 502
  ServiceUnavailable,  // 503
  GatewayTimeout,      // 504
  HTTPVersionNotSupported, // 505
} from '@b9g/http-errors';
```

## Usage Examples

### Basic Error Responses

```javascript
import { NotFound, BadRequest } from '@b9g/http-errors';

// Simple message
const error1 = NotFound('User not found');

// With additional details
const error2 = BadRequest('Invalid email format', {
  field: 'email',
  code: 'INVALID_FORMAT'
});
```

### Router Integration

```javascript
import { Router } from '@b9g/router';
import { NotFound, BadRequest, Unauthorized } from '@b9g/http-errors';

const router = new Router();

router.get('/users/:id', async (request, context) => {
  const { id } = context.params;
  
  // Validate input
  if (!id || isNaN(Number(id))) {
    return BadRequest('Invalid user ID');
  }
  
  // Check authentication
  if (!request.headers.get('authorization')) {
    return Unauthorized('Authentication required');
  }
  
  // Find user
  const user = await db.users.find(id);
  if (!user) {
    return NotFound('User not found');
  }
  
  return Response.json(user);
});
```

### Middleware Error Handling

```javascript
router.use(async function* (request, context) {
  try {
    return yield request;
  } catch (error) {
    console.error('Request failed:', error);
    return InternalServerError('Something went wrong');
  }
});
```

### Custom Error Details

```javascript
import { BadRequest, Conflict } from '@b9g/http-errors';

// With error code
const validationError = BadRequest('Validation failed', {
  code: 'VALIDATION_ERROR',
  fields: ['email', 'password']
});

// With retry information
const rateLimitError = TooManyRequests('Rate limit exceeded', {
  retryAfter: 60,
  limit: 100,
  window: 3600
});

// With conflict details
const duplicateError = Conflict('Email already exists', {
  field: 'email',
  value: 'user@example.com'
});
```

## API Reference

### Error Functions

All error functions follow the same signature:

```typescript
function ErrorName(message?: string, details?: any): Response
```

#### Parameters

- `message` (optional): Human-readable error message
- `details` (optional): Additional error details (serialized as JSON)

#### Returns

Returns a `Response` object with:
- Appropriate HTTP status code
- `Content-Type: application/json`
- JSON body containing error information

### Response Format

```javascript
{
  "error": {
    "type": "NotFound",
    "message": "User not found",
    "status": 404,
    "details": {
      // Any additional details provided
    }
  }
}
```

## TypeScript Support

Full TypeScript definitions included:

```typescript
import type { ErrorResponse } from '@b9g/http-errors';

function handleError(): ErrorResponse {
  return NotFound('Resource not found');
}

// ErrorResponse extends Response
const response: Response = handleError();
```

## Integration Examples

### API Error Handling

```javascript
import { 
  BadRequest, 
  NotFound, 
  Conflict, 
  InternalServerError 
} from '@b9g/http-errors';

router.post('/api/users', async (request) => {
  try {
    const data = await request.json();
    
    // Validation
    if (!data.email) {
      return BadRequest('Email is required');
    }
    
    // Check for existing user
    const existing = await db.users.findByEmail(data.email);
    if (existing) {
      return Conflict('Email already registered');
    }
    
    // Create user
    const user = await db.users.create(data);
    return Response.json(user, { status: 201 });
    
  } catch (error) {
    return InternalServerError('Failed to create user');
  }
});
```

### Auth Middleware

```javascript
import { Unauthorized, Forbidden } from '@b9g/http-errors';

const authMiddleware = async function* (request, context) {
  const token = request.headers.get('authorization');
  
  if (!token) {
    return Unauthorized('Authentication required');
  }
  
  try {
    const user = await verifyToken(token);
    context.user = user;
    return yield request;
  } catch (error) {
    return Forbidden('Invalid or expired token');
  }
};

router.use('/api/admin/*', authMiddleware);
```

### Input Validation

```javascript
import { BadRequest } from '@b9g/http-errors';

function validateUser(data) {
  const errors = [];
  
  if (!data.email) errors.push('email is required');
  if (!data.password) errors.push('password is required');
  if (data.password && data.password.length < 8) {
    errors.push('password must be at least 8 characters');
  }
  
  if (errors.length > 0) {
    return BadRequest('Validation failed', { errors });
  }
  
  return null; // Valid
}

router.post('/register', async (request) => {
  const data = await request.json();
  
  const validationError = validateUser(data);
  if (validationError) return validationError;
  
  // Process valid data...
});
```

## License

MIT
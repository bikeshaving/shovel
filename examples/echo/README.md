# Echo

HTTP request echo and debugging API. Send requests, get detailed information back.

**Live at:** https://echo.shovel.run
**Documentation:** https://echo.shovel.run (interactive examples)

## Features

- Full CORS support with simulation
- All HTTP methods supported
- JSON, form data, and text body parsing
- Real IP detection (works behind proxies/CDNs)
- Authentication simulation (Bearer, Basic, Cookie, CSRF)
- CORS testing and restrictions
- Redirect handling and loops
- Cache control headers
- Content type overrides
- Status code and delay control
- No rate limiting
- No authentication required (unless simulated)
- Clean header-based control mechanism

## API

### Endpoint

**`ALL /echo`**

Echoes back complete request information including method, path, query params, headers, body, and IP address.

```bash
curl https://echo.shovel.run/echo
```

**Example Response:**

```json
{
  "method": "GET",
  "path": "/echo",
  "query": {},
  "headers": {
    "user-agent": "curl/8.0.0",
    "accept": "*/*",
    ...
  },
  "ip": "1.2.3.4",
  "userAgent": "curl/8.0.0",
  "timestamp": "2025-10-16T12:00:00.000Z",
  "protocol": "https",
  "host": "echo.shovel.run",
  "body": null,
  "contentType": null
}
```

### Control Headers

Modify response behavior using `X-Echo-*` headers:

#### `X-Echo-Delay`

Delay response by specified seconds (1-10). Perfect for testing loading states.

```bash
curl https://echo.shovel.run/echo -H "X-Echo-Delay: 3"
```

**Response includes:**
```json
{
  ...
  "delayed": "3 seconds"
}
```

#### `X-Echo-Status`

Return a specific HTTP status code (100-599). Great for testing error handling.

```bash
curl https://echo.shovel.run/echo -H "X-Echo-Status: 404"
```

**Response includes:**
```json
{
  ...
  "requestedStatus": 404
}
```

#### `X-Echo-CORS`

Simulate CORS restrictions for testing cross-origin behavior.

```bash
# Block CORS entirely (no Access-Control headers)
curl https://echo.shovel.run/echo -H "X-Echo-CORS: block"

# Restrict to specific origin
curl https://echo.shovel.run/echo -H "X-Echo-CORS: origin:myapp.com"

# Limit allowed methods
curl https://echo.shovel.run/echo -H "X-Echo-CORS: methods:GET,POST"

# Restrict headers and disable credentials
curl https://echo.shovel.run/echo -H "X-Echo-CORS: headers:content-type,credentials:false"

# Complex CORS restrictions
curl https://echo.shovel.run/echo -H "X-Echo-CORS: origin:app.com,methods:POST,headers:authorization"
```

#### `X-Echo-Auth`

Simulate various authentication scenarios.

```bash
# Require authentication (401 Unauthorized)
curl https://echo.shovel.run/echo -H "X-Echo-Auth: unauthorized"

# Forbidden access (403 Forbidden)
curl https://echo.shovel.run/echo -H "X-Echo-Auth: forbidden"

# Require specific Bearer token
curl https://echo.shovel.run/echo -H "X-Echo-Auth: bearer:secret123" -H "Authorization: Bearer secret123"

# Require basic authentication
curl https://echo.shovel.run/echo -H "X-Echo-Auth: basic:user:pass" -u user:pass

# Require specific cookie value
curl https://echo.shovel.run/echo -H "X-Echo-Auth: cookie:session123" -b "session=session123"

# Require CSRF token
curl https://echo.shovel.run/echo -H "X-Echo-Auth: csrf" -H "X-CSRF-Token: token456"

# Simulate expired token
curl https://echo.shovel.run/echo -H "X-Echo-Auth: expired"
```

#### `X-Echo-Redirect`

Test redirect scenarios and redirect handling.

```bash
# Permanent redirect (301)
curl https://echo.shovel.run/echo -H "X-Echo-Redirect: 301:https://example.com"

# Temporary redirect (302)
curl https://echo.shovel.run/echo -H "X-Echo-Redirect: 302:https://temp.com"

# Redirect to relative path
curl https://echo.shovel.run/echo -H "X-Echo-Redirect: 302:/echo"

# Create redirect loop for testing
curl https://echo.shovel.run/echo -H "X-Echo-Redirect: loop"
```

#### `X-Echo-Cache`

Control caching headers for testing cache behavior.

```bash
# Disable caching
curl https://echo.shovel.run/echo -H "X-Echo-Cache: no-cache"

# Set cache max age
curl https://echo.shovel.run/echo -H "X-Echo-Cache: max-age:3600"

# Include ETag for conditional requests
curl https://echo.shovel.run/echo -H "X-Echo-Cache: etag:abc123"

# Combine cache controls
curl https://echo.shovel.run/echo -H "X-Echo-Cache: max-age:1800,etag:version1"
```

#### `X-Echo-Content-Type`

Override response content type for testing MIME type handling.

```bash
# Return as XML
curl https://echo.shovel.run/echo -H "X-Echo-Content-Type: application/xml"

# Return as plain text
curl https://echo.shovel.run/echo -H "X-Echo-Content-Type: text/plain"

# Return as binary
curl https://echo.shovel.run/echo -H "X-Echo-Content-Type: application/octet-stream"

# Custom content type
curl https://echo.shovel.run/echo -H "X-Echo-Content-Type: application/vnd.api+json"
```

#### Combining Control Headers

Use multiple control headers together:

```bash
curl https://echo.shovel.run/echo \
  -H "X-Echo-Delay: 2" \
  -H "X-Echo-Status: 500"

# Test slow authenticated request with CORS
curl https://echo.shovel.run/echo \
  -H "X-Echo-Delay: 3" \
  -H "X-Echo-Auth: bearer:token123" \
  -H "X-Echo-CORS: origin:myapp.com" \
  -H "Authorization: Bearer token123"
```

## Examples

### Echo a GET request

```bash
curl https://echo.shovel.run/echo?foo=bar&baz=qux
```

### Echo a POST request with JSON

```bash
curl -X POST https://echo.shovel.run/echo \
  -H "Content-Type: application/json" \
  -d '{"hello": "world", "foo": "bar"}'
```

### Test loading states

```bash
curl https://echo.shovel.run/echo -H "X-Echo-Delay: 5"
```

### Test error handling

```bash
curl https://echo.shovel.run/echo -H "X-Echo-Status: 500"
```

### Complex example

```bash
curl -X POST https://echo.shovel.run/echo?test=true \
  -H "Content-Type: application/json" \
  -H "X-Echo-Delay: 2" \
  -H "X-Echo-Status: 201" \
  -d '{"action": "create", "data": {"name": "test"}}'
```

## Use Cases

- **Webhook testing** - See exactly what your webhook sends
- **HTTP client debugging** - Verify headers, body, and request structure
- **CORS testing** - Simulate origin restrictions, method limitations, and preflight failures
- **Authentication testing** - Test Bearer tokens, Basic auth, cookies, and CSRF protection
- **Error handling** - Simulate 401/403 responses, expired tokens, and auth failures
- **Async demos** - Use delay header to demonstrate loading states
- **Status simulation** - Test any HTTP status code scenario
- **Frontend integration** - Test auth flows, CORS policies, and error handling
- **Learning HTTP** - See how different request types work
- **API development** - Quick echo endpoint for prototyping

## Development

```bash
# Install dependencies
bun install

# Run development server
bun run develop

# Visit http://localhost:7777
```

## Tech Stack

- **Framework:** Shovel
- **Runtime:** Node.js / Bun
- **Language:** TypeScript

## License

MIT

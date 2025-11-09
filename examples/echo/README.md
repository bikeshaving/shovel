# reqback

HTTP request echo and debugging API. Send requests, get detailed information back.

**Live at:** https://reqback.fly.dev  
**Documentation:** https://reqback.fly.dev (interactive examples)  
**Source:** https://github.com/brainkim/reqback

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
- Fast Bun-powered server

## API

### Endpoint

**`ALL /echo`**

Echoes back complete request information including method, path, query params, headers, body, and IP address.

```bash
curl https://reqback.fly.dev/echo
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
  "host": "reqback.com",
  "body": null,
  "contentType": null
}
```

### Control Headers

Modify response behavior using `X-Reqback-*` headers:

#### `X-Reqback-Delay`

Delay response by specified seconds (1-10). Perfect for testing loading states.

```bash
curl https://reqback.fly.dev/echo -H "X-Reqback-Delay: 3"
```

**Response includes:**
```json
{
  ...
  "delayed": "3 seconds"
}
```

#### `X-Reqback-Status`

Return a specific HTTP status code (100-599). Great for testing error handling.

```bash
curl https://reqback.fly.dev/echo -H "X-Reqback-Status: 404"
```

**Response includes:**
```json
{
  ...
  "requestedStatus": 404
}
```

#### `X-Reqback-CORS`

Simulate CORS restrictions for testing cross-origin behavior.

```bash
# Block CORS entirely (no Access-Control headers)
curl https://reqback.fly.dev/echo -H "X-Reqback-CORS: block"

# Restrict to specific origin
curl https://reqback.fly.dev/echo -H "X-Reqback-CORS: origin:myapp.com"

# Limit allowed methods
curl https://reqback.fly.dev/echo -H "X-Reqback-CORS: methods:GET,POST"

# Restrict headers and disable credentials
curl https://reqback.fly.dev/echo -H "X-Reqback-CORS: headers:content-type,credentials:false"

# Complex CORS restrictions
curl https://reqback.fly.dev/echo -H "X-Reqback-CORS: origin:app.com,methods:POST,headers:authorization"
```

#### `X-Reqback-Auth`

Simulate various authentication scenarios.

```bash
# Require authentication (401 Unauthorized)
curl https://reqback.fly.dev/echo -H "X-Reqback-Auth: unauthorized"

# Forbidden access (403 Forbidden)
curl https://reqback.fly.dev/echo -H "X-Reqback-Auth: forbidden"

# Require specific Bearer token
curl https://reqback.fly.dev/echo -H "X-Reqback-Auth: bearer:secret123" -H "Authorization: Bearer secret123"

# Require basic authentication
curl https://reqback.fly.dev/echo -H "X-Reqback-Auth: basic:user:pass" -u user:pass

# Require specific cookie value
curl https://reqback.fly.dev/echo -H "X-Reqback-Auth: cookie:session123" -b "session=session123"

# Require CSRF token
curl https://reqback.fly.dev/echo -H "X-Reqback-Auth: csrf" -H "X-CSRF-Token: token456"

# Simulate expired token
curl https://reqback.fly.dev/echo -H "X-Reqback-Auth: expired"
```

#### `X-Reqback-Redirect`

Test redirect scenarios and redirect handling.

```bash
# Permanent redirect (301)
curl https://reqback.fly.dev/echo -H "X-Reqback-Redirect: 301:https://example.com"

# Temporary redirect (302)
curl https://reqback.fly.dev/echo -H "X-Reqback-Redirect: 302:https://temp.com"

# Redirect to relative path
curl https://reqback.fly.dev/echo -H "X-Reqback-Redirect: 302:/echo"

# Create redirect loop for testing
curl https://reqback.fly.dev/echo -H "X-Reqback-Redirect: loop"
```

#### `X-Reqback-Cache`

Control caching headers for testing cache behavior.

```bash
# Disable caching
curl https://reqback.fly.dev/echo -H "X-Reqback-Cache: no-cache"

# Set cache max age
curl https://reqback.fly.dev/echo -H "X-Reqback-Cache: max-age:3600"

# Include ETag for conditional requests
curl https://reqback.fly.dev/echo -H "X-Reqback-Cache: etag:abc123"

# Combine cache controls
curl https://reqback.fly.dev/echo -H "X-Reqback-Cache: max-age:1800,etag:version1"
```

#### `X-Reqback-Content-Type`

Override response content type for testing MIME type handling.

```bash
# Return as XML
curl https://reqback.fly.dev/echo -H "X-Reqback-Content-Type: application/xml"

# Return as plain text
curl https://reqback.fly.dev/echo -H "X-Reqback-Content-Type: text/plain"

# Return as binary
curl https://reqback.fly.dev/echo -H "X-Reqback-Content-Type: application/octet-stream"

# Custom content type
curl https://reqback.fly.dev/echo -H "X-Reqback-Content-Type: application/vnd.api+json"
```

#### Combining Control Headers

Use multiple control headers together:

```bash
curl https://reqback.fly.dev/echo \
  -H "X-Reqback-Delay: 2" \
  -H "X-Reqback-Status: 500"

# Test slow authenticated request with CORS
curl https://reqback.fly.dev/echo \
  -H "X-Reqback-Delay: 3" \
  -H "X-Reqback-Auth: bearer:token123" \
  -H "X-Reqback-CORS: origin:myapp.com" \
  -H "Authorization: Bearer token123"
```

## Examples

### Echo a GET request

```bash
curl https://reqback.fly.dev/echo?foo=bar&baz=qux
```

### Echo a POST request with JSON

```bash
curl -X POST https://reqback.com/api/v1 \
  -H "Content-Type: application/json" \
  -d '{"hello": "world", "foo": "bar"}'
```

### Test loading states

```bash
curl https://reqback.fly.dev/echo -H "X-Reqback-Delay: 5"
```

### Test error handling

```bash
curl https://reqback.fly.dev/echo -H "X-Reqback-Status: 500"
```

### Complex example

```bash
curl -X POST https://reqback.com/api/v1?test=true \
  -H "Content-Type: application/json" \
  -H "X-Reqback-Delay: 2" \
  -H "X-Reqback-Status: 201" \
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

## CONTRIBUTING

### Development

```bash
# Install dependencies
bun install

# Run development server
bun run dev

# Visit http://localhost:3000
```

### Production

```bash
bun run start
```
## Deployment

### Fly.io

```bash
# Login to Fly.io
fly auth login

# Launch app (first time)
fly launch

# Deploy updates
fly deploy

# Check status
fly status

# View logs
fly logs
```

### Custom Domain

```bash
# Add custom domain
fly certs add reqback.com
fly certs add www.reqback.com

# Check certificate status
fly certs show reqback.com
```

Then add DNS records:
```
A record:    @ -> [Fly.io IP]
AAAA record: @ -> [Fly.io IPv6]
CNAME:       www -> [your-app].fly.dev
```

## Tech Stack

- **Runtime:** Bun
- **Language:** TypeScript
- **Hosting:** Fly.io (recommended)
- **Dependencies:** None! Pure Bun HTTP server

## Architecture

Simple, clean architecture:
- Single TypeScript file (`src/index.ts`)
- No frameworks or routing libraries
- Pure Bun HTTP server
- Header-based control mechanism
- Inline HTML documentation

## Why reqback?

- **Simple** - One endpoint, clear behavior
- **Fast** - Bun-powered, no framework overhead
- **Clean** - Header-based controls don't pollute query params
- **Flexible** - Supports all HTTP methods and content types
- **Educational** - See exactly what servers receive
- **Free** - No rate limits, no authentication required

## License

MIT

## Contributing

Issues and PRs welcome!

## Credits

Built with Bun

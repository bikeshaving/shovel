# Reqback - Node.js Shovel Example

HTTP request echo and debugging API built with Shovel's **Node.js platform**.

This example demonstrates how to use Shovel with the Node.js runtime and platform adapter, in contrast to the blog example which uses Bun.

## Features

- **Node.js Platform Testing**: Exclusively uses `@b9g/platform-node` 
- **HTTP Echo Service**: Complete request information debugging
- **Control Headers**: Simulate various HTTP scenarios (delays, status codes, CORS, auth)
- **Request Parsing**: JSON, form data, and text body support
- **IP Detection**: Works behind proxies and CDNs

## Development

```bash
# Install dependencies
npm install

# Start development server with Node.js platform (auto-detects)
npm run develop

# Or explicitly specify Node.js platform  
npm run develop -- --platform node

# Build for production
npm run build

# Run built version
npm run start
```

## API Endpoints

### `ALL /echo`
Echoes back complete request information including method, path, query params, headers, body, and IP address.

```bash
curl http://localhost:3000/echo
```

### Control Headers

- `X-Reqback-Delay: 1-10` - Delay response by seconds
- `X-Reqback-Status: 100-599` - Return specific HTTP status  
- `X-Reqback-CORS: origin:example.com` - CORS simulation
- `X-Reqback-Auth: bearer:token123` - Authentication testing
- `X-Reqback-Redirect: 301:https://example.com` - Redirect testing
- `X-Reqback-Cache: max-age:3600` - Cache control headers
- `X-Reqback-Content-Type: application/xml` - Override content type

## Shovel Platform Comparison

| Example | Platform | Runtime | Command |
|---------|----------|---------|---------|
| **blog** | `@b9g/platform-bun` | Bun | `bun run --bun develop --platform bun` |
| **reqback** | `@b9g/platform-node` | Node.js | `npm run develop` |

This provides a clear way to test both platform adapters and ensure they work correctly.

## Use Cases

- Webhook testing and debugging
- HTTP client development  
- CORS policy validation
- Authentication flow testing
- Node.js platform verification
- Shovel framework testing
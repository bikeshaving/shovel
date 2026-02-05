# Shovel Admin

Admin dashboard with Google OAuth authentication and Redis caching.

**Live at:** https://admin.shovel.run

## Features

- **Bun Platform** - Deployed to Fly.io
- **Google OAuth** - PKCE-based authentication with `@b9g/auth`
- **Redis Cache** - Response caching with `@b9g/cache-redis`
- **Router** - Request routing with `@b9g/router`

## Packages Used

- `@b9g/platform-bun` - Bun platform
- `@b9g/auth` - OAuth2/PKCE authentication
- `@b9g/cache-redis` - Redis cache adapter
- `@b9g/router` - Request routing

## Environment Variables

```bash
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:7777/auth/callback
REDIS_URL=redis://localhost:6379
```

## Development

```bash
# Install dependencies
bun install

# Start Redis (optional)
docker run -d -p 6379:6379 redis

# Run development server
bun run develop

# Visit http://localhost:7777
```

## Deployment

```bash
# Set secrets on Fly.io
fly secrets set GOOGLE_CLIENT_ID=...
fly secrets set GOOGLE_CLIENT_SECRET=...
fly secrets set GOOGLE_REDIRECT_URI=https://admin.shovel.run/auth/callback

# Deploy
fly deploy
```

## Project Structure

```
src/
  server.ts    # Main application with OAuth and caching
fly.toml       # Fly.io deployment config
```

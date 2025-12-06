# Shovel Blog

A sample blog application built with Shovel for Cloudflare Workers.

**Live at:** https://blog.shovel.run

## Features

- **Cloudflare Workers** - Deployed to the edge
- **Cache-First Architecture** - Fast by default with `@b9g/cache`
- **Static Assets** - Content-hashed assets with `@b9g/assets`
- **Router** - Universal routing with `@b9g/router`

## Packages Used

- `@b9g/platform-cloudflare` - Cloudflare Workers platform
- `@b9g/router` - Request routing
- `@b9g/cache` - Cache API
- `@b9g/assets` - Static asset handling
- `@b9g/match-pattern` - URLPattern matching

## Development

```bash
# Install dependencies
bun install

# Run development server (uses miniflare)
bun run develop

# Build for production
bun run build

# Deploy to Cloudflare
bun run deploy
```

## Routes

- `/` - Home page with blog posts
- `/posts/:id` - Individual blog post pages
- `/about` - About page
- `/api/posts` - JSON API endpoint
- `/static/*` - Static assets

## Project Structure

```
src/
  server.ts    # Main application
  assets/      # Static assets (CSS, images)
wrangler.toml  # Cloudflare configuration
```

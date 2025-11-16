# Shovel Blog App

A demo blog app showcasing Shovel's cache-first architecture and Django-inspired app patterns.

## Features

- **Cache-First Routing**: Every request goes through cache first for optimal performance
- **Multiple Cache Strategies**: Separate caches for pages, API responses, and static files
- **Static File Handling**: Django-style staticfiles with automatic optimization
- **Universal Deployment**: Same code works for SSG, SSR, and SPA

## Architecture

```
src/server.js       # Main application with router and caches
src/assets/         # Static assets (CSS, images, etc.)
```

## Shovel Apps Used

- **@b9g/router** - Universal request routing with middleware support
- **@b9g/cache** - Multiple cache backends with TTL and LRU eviction
- **@b9g/staticfiles** - Static file handling with content hashing
- **@b9g/match-pattern** - Enhanced URLPattern with trailing slash normalization

## Development

```bash
# Install dependencies
bun install

# Start development server (serves from source files)
bun run develop

# Build for production (optimizes and hashes assets)
bun run build

# Preview built site
bun run preview
```

## Cache Strategy

- **Pages Cache**: Long-lived HTML pages with 5-10 minute TTL
- **API Cache**: Short-lived API responses with 3 minute TTL
- **Static Cache**: Long-term cached assets with content hashing

## Routes

- `/` - Home page with blog posts
- `/posts/:id` - Individual blog post pages
- `/about` - About page with architecture info
- `/api/posts` - JSON API endpoint
- `/static/*` - Static assets (CSS, images, etc.)

## How It Works

1. **Development Mode**: Assets served directly from `src/` directory
2. **Build Process**: ESBuild + staticfiles plugin processes assets
3. **Production Mode**: Assets served from manifest with content hashing
4. **Cache Layer**: All requests flow through appropriate cache first

This demonstrates Shovel's Django-like app architecture where each `@b9g/*` package provides focused functionality that composes together seamlessly.

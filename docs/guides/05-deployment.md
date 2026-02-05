---
title: Deployment
description: Deploy Shovel applications to production
publish: true
---

# Deployment

Shovel applications can be deployed to various platforms. This guide covers production deployment patterns.

## Building for Production

```bash
shovel build src/server.ts
```

This creates a `dist/` directory with your bundled application:

```
dist/
├── server/
│   ├── worker.js      # Bundled ServiceWorker
│   ├── server.js      # Server entry point
│   └── package.json   # Dependencies
└── public/            # Static assets
```

---

## Node.js

### Direct Execution

```bash
cd dist/server
node server.js
```

### With Process Manager (PM2)

```bash
npm install -g pm2

cd dist/server
pm2 start server.js --name my-app -i max
```

PM2 ecosystem file (`ecosystem.config.js`):

```javascript
module.exports = {
  apps: [{
    name: "my-app",
    script: "server.js",
    cwd: "./dist/server",
    instances: "max",
    exec_mode: "cluster",
    env: {
      NODE_ENV: "production",
      PORT: 7777,
    },
  }],
};
```

### Environment Variables

```bash
PORT=8080 HOST=0.0.0.0 node dist/server/server.js
```

---

## Bun

### Direct Execution

```bash
cd dist/server
bun server.js
```

### With Multiple Workers

Configure workers in `shovel.json`:

```json
{
  "workers": 4
}
```

Or via environment variable:

```bash
WORKERS=4 bun dist/server/server.js
```

---

## Docker

### Dockerfile (Node.js)

```dockerfile
FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx shovel build src/server.ts

FROM node:20-slim

WORKDIR /app
COPY --from=builder /app/dist/server ./
COPY --from=builder /app/dist/public ../public

ENV NODE_ENV=production
ENV PORT=7777
ENV HOST=0.0.0.0

EXPOSE 7777
CMD ["node", "server.js"]
```

### Dockerfile (Bun)

```dockerfile
FROM oven/bun:1 AS builder

WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run shovel build src/server.ts

FROM oven/bun:1-slim

WORKDIR /app
COPY --from=builder /app/dist/server ./
COPY --from=builder /app/dist/public ../public

ENV NODE_ENV=production
ENV PORT=7777
ENV HOST=0.0.0.0

EXPOSE 7777
CMD ["bun", "server.js"]
```

### Docker Compose

```yaml
version: "3.8"

services:
  app:
    build: .
    ports:
      - "7777:7777"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgres://user:pass@db:5432/myapp
    depends_on:
      - db

  db:
    image: postgres:15
    environment:
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
      - POSTGRES_DB=myapp
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

---

## Cloudflare Workers

### Configuration

Set platform in `shovel.json`:

```json
{
  "platform": "cloudflare"
}
```

### Build

```bash
shovel build src/server.ts --platform cloudflare
```

Output structure:

```
dist/
├── server/
│   └── server.js      # Single bundled worker
└── public/            # Static assets
```

### wrangler.toml

```toml
name = "my-app"
main = "dist/server/server.js"
compatibility_date = "2024-01-01"

[site]
bucket = "./dist/public"

[[d1_databases]]
binding = "DB"
database_name = "my-database"
database_id = "xxx"

[[r2_buckets]]
binding = "UPLOADS"
bucket_name = "my-uploads"
```

### Deploy

```bash
npx wrangler deploy
```

### Bindings

Configure Cloudflare bindings in `shovel.json`:

```json
{
  "databases": {
    "main": {
      "binding": "DB"
    }
  },
  "directories": {
    "uploads": {
      "binding": "UPLOADS"
    }
  }
}
```

---

## Reverse Proxy

### Nginx

```nginx
upstream shovel_app {
    server 127.0.0.1:7777;
    keepalive 64;
}

server {
    listen 80;
    server_name example.com;

    location / {
        proxy_pass http://shovel_app;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
    }

    location /static/ {
        alias /app/dist/public/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### Caddy

```
example.com {
    reverse_proxy localhost:7777

    handle /static/* {
        root * /app/dist/public
        file_server
        header Cache-Control "public, max-age=31536000, immutable"
    }
}
```

---

## Health Checks

Add a health check endpoint:

```typescript
router.route("/health").get(() => {
  return Response.json({ ok: true });
});

router.route("/ready").get(async () => {
  try {
    // Check database connection
    const db = databases.get("main");
    await db.get`SELECT 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
});
```

### Docker Health Check

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:7777/health || exit 1
```

### Kubernetes

```yaml
apiVersion: v1
kind: Pod
spec:
  containers:
    - name: app
      image: my-app:latest
      livenessProbe:
        httpGet:
          path: /health
          port: 7777
        initialDelaySeconds: 5
        periodSeconds: 10
      readinessProbe:
        httpGet:
          path: /ready
          port: 7777
        initialDelaySeconds: 5
        periodSeconds: 10
```

---

## Environment Configuration

### Production shovel.json

```json
{
  "port": "$PORT || 7777",
  "host": "$HOST || 0.0.0.0",
  "workers": "$WORKERS || 4",
  "databases": {
    "main": {
      "module": "$PLATFORM === bun ? @b9g/zen/bun : @b9g/zen/better-sqlite3",
      "url": "$DATABASE_URL"
    }
  },
  "logging": {
    "sinks": {
      "console": {
        "module": "@logtape/logtape",
        "export": "getConsoleSink"
      }
    },
    "loggers": [
      {
        "category": "app",
        "level": "$NODE_ENV === production ? info : debug",
        "sinks": ["console"]
      }
    ]
  }
}
```

### Required Environment Variables

Document required variables for deployment:

```bash
# Required
DATABASE_URL=postgres://user:pass@host:5432/db

# Optional (with defaults)
PORT=7777
HOST=0.0.0.0
WORKERS=4
NODE_ENV=production
```

---

## Graceful Shutdown

Shovel handles SIGINT and SIGTERM for graceful shutdown:

1. Stop accepting new connections
2. Wait for in-flight requests to complete
3. Close database connections
4. Exit cleanly

Configure shutdown timeout in your process manager or orchestrator.

---

## See Also

- [CLI](./cli.md) - Build commands
- [shovel.json](./shovel-json.md) - Configuration reference
- [Databases](./databases.md) - Database configuration
- [Directories](./directories.md) - File storage

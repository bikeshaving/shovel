# CLI

Command-line interface for Shovel.

---

## Commands

| Command | Description |
|---------|-------------|
| `shovel create` | Create a new project |
| `shovel develop` | Start development server |
| `shovel build` | Build for production |

---

## shovel create

```bash
shovel create [name]
npm create shovel
```

### Templates

| Template | Description |
|----------|-------------|
| `hello-world` | Minimal fetch handler |
| `api` | REST endpoints |
| `static-site` | Static file serving |
| `full-stack` | HTML + API + assets |

---

## shovel develop

```bash
shovel develop <entrypoint> [options]
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --port <port>` | Server port | `3000` |
| `-h, --host <host>` | Server host | `localhost` |
| `-w, --workers <count>` | Worker count | `1` |
| `--platform <name>` | Target platform | Auto-detected |

### Examples

```bash
shovel develop src/server.ts
shovel develop src/server.ts --port 8080
shovel develop src/server.ts --host 0.0.0.0
```

---

## shovel build

```bash
shovel build <entrypoint> [options]
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--platform <name>` | Target platform | Auto-detected |
| `--lifecycle [stage]` | Run lifecycle events | - |

### Examples

```bash
shovel build src/server.ts
shovel build src/server.ts --platform cloudflare
shovel build src/server.ts --lifecycle
```

### Output

Node.js / Bun:

```
dist/
├── server/
│   ├── worker.js
│   ├── server.js
│   └── config.js
└── public/
```

Cloudflare:

```
dist/
├── server/
│   └── server.js
└── public/
```

### --lifecycle

Runs ServiceWorker lifecycle events without starting server.

| Stage | Events |
|-------|--------|
| `install` | install only |
| `activate` | install + activate (default) |

---

## Platform Detection

1. CLI `--platform` option
2. `platform` in `shovel.json`
3. Cloudflare Workers environment
4. Runtime detection (`bun` or `node`)

---

## Environment Variables

| Variable | CLI Option |
|----------|-----------|
| `PORT` | `--port` |
| `HOST` | `--host` |
| `WORKERS` | `--workers` |
| `PLATFORM` | `--platform` |

---

## See Also

- [shovel.json](./shovel-json.md) - Configuration reference


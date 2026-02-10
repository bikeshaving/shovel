# create-shovel

Scaffold a new [Shovel](https://github.com/bikeshaving/shovel) project. Creates a ServiceWorker-based web application with your choice of template, UI framework, and platform.

## Quick Start

```bash
npm create shovel my-app
# or
bun create shovel my-app
# or
pnpm create shovel my-app
```

Then follow the prompts.

## Templates

| Template | Description |
|----------|-------------|
| **Hello World** | Minimal fetch handler |
| **API** | REST endpoints with JSON responses |
| **Static Site** | Server-rendered HTML pages |
| **Full Stack** | HTML pages + API routes |

### UI Frameworks

Static Site and Full Stack templates prompt for a UI framework:

- **Vanilla** -- Plain HTML
- **HTMX** -- HTML-driven interactions via `hx-` attributes
- **Alpine.js** -- Lightweight reactivity via `x-data` directives
- **Crank.js** -- JSX components rendered server-side

Shorthand: `--template crank` selects Static Site + Crank.js.

### Platforms

- **Node.js** -- Worker threads + `ws` WebSocket
- **Bun** -- Native `Bun.serve()` + `reusePort` load balancing
- **Cloudflare Workers** -- Edge deployment on Cloudflare

The default is auto-detected from your package manager.

## CLI Flags

Skip prompts with flags:

```bash
npm create shovel my-app --template api --typescript --platform node
npm create shovel my-app --template crank --no-typescript --platform bun
```

| Flag | Values |
|------|--------|
| `--template` | `hello-world`, `api`, `static-site`, `full-stack`, `crank` |
| `--typescript` / `--no-typescript` | Enable/disable TypeScript |
| `--platform` | `node`, `bun`, `cloudflare` |

## What Gets Generated

```
my-app/
├── src/
│   ├── app.{ts,tsx,js,jsx}   # Application entry point
│   └── env.d.ts              # TypeScript declarations (if TS)
├── package.json
├── tsconfig.json             # If TypeScript
├── .gitignore
└── README.md
```

Generated `package.json` scripts:

```json
{
  "develop": "shovel develop src/app.ts --platform node",
  "build": "shovel build src/app.ts --platform node",
  "start": "node dist/server/supervisor.js"
}
```

## License

MIT

# Glossary

This glossary defines the terms used across Shovel docs and CLI output. It is intentionally concise and scoped to features described in this documentation set.

## Assets

Static files handled by Shovel’s asset pipeline and emitted to `dist/public/` during builds. See [Assets](./assets.md).

## AsyncContext

Request-scoped state storage that stays isolated per request. See [AsyncContext](./async-context.md).

## Build

The `shovel build` command that compiles your ServiceWorker entrypoint into a production-ready bundle. See [CLI](./cli.md#shovel-build).

## Build Output (`dist/`)

The output directory for production builds. Shovel writes bundled server code under `dist/server/` and static assets under `dist/public/`. See [CLI](./cli.md#output-structure).

## Cache / Caches

Response caching APIs backed by platform-specific cache storage. See [Caches](./caches.md).

## Configuration

Project configuration via `shovel.json` and environment variables. See [shovel.json](./shovel-json.md).

## Databases

SQL database access and migrations from within the ServiceWorker runtime. See [Databases](./databases.md).

## Develop Server

The `shovel develop` command that runs a development server with hot reload. See [CLI](./cli.md#shovel-develop).

## Directories

File system access abstraction for reading and writing files. See [Directories](./directories.md).

## Entry Point

The ServiceWorker script you pass to the CLI, such as `src/server.ts`. It registers event handlers and contains your app logic.

## Environment Variables

CLI options can be provided via environment variables like `PORT`, `HOST`, and `PLATFORM`. See [CLI](./cli.md#environment-variables).

## Fetch Event

The ServiceWorker event that handles incoming HTTP requests. See [ServiceWorker](./serviceworker.md#fetch-event).

## Lifecycle

The ServiceWorker lifecycle stages, primarily `install` and `activate`, which Shovel can run during builds via `--lifecycle`. See [ServiceWorker](./serviceworker.md#lifecycle) and [CLI](./cli.md#the---lifecycle-flag).

## Middleware

Composable request/response processing before your route handlers run. See [Middleware](./middleware.md).

## Platform

The target runtime for your application, selected via `--platform` or `shovel.json` and auto-detected when omitted. Supported values include `node`, `bun`, and `cloudflare`. See [CLI](./cli.md#platform-detection) and [shovel.json](./shovel-json.md#platform).

## Public Directory (`public/`)

Optional directory for static files in a project. See [Assets](./assets.md).

## Routing

URL routing and handler composition for requests. See [Routing](./routing.md).

## ServiceWorker

The execution model Shovel uses for handling requests, with ServiceWorker-like lifecycle events and global APIs. See [ServiceWorker](./serviceworker.md).

## shovel.json

Project configuration file that controls build, platform, and other settings. See [shovel.json](./shovel-json.md).

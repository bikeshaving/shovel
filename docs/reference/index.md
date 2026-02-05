# API Reference

API documentation organized by package. For step-by-step introductions, see the [Guides](../guides/index.md).

---

## shovel

The CLI and core framework.

- [CLI](./cli.md) - Command-line interface
- [shovel.json](./shovel-json.md) - Configuration file format
- [ServiceWorker](./serviceworker.md) - Lifecycle events and globals
- [Assets](./assets.md) - Static asset pipeline
- [Glossary](./glossary.md) - Terminology

---

## @b9g/router

Fast, fetch-based routing with middleware.

- [Routing](./routing.md) - Router class, route matching, handlers
- [Middleware](./middleware.md) - Function and generator middleware

---

## @b9g/cache

Cache API implementation for servers.

- [Caches](./caches.md) - CacheStorage and Cache classes

---

## @b9g/filesystem

FileSystem API for servers.

- [Directories](./directories.md) - FileSystemDirectoryHandle API

---

## @b9g/zen

SQL database abstraction with migrations.

- [Databases](./databases.md) - Database class, queries, migrations

---

## @b9g/http-errors

HTTP error classes.

- [HTTP Errors](./http-errors.md) - Error classes and handling

---

## @b9g/async-context

Request-scoped state using AsyncLocalStorage.

- [AsyncContext](./async-context.md) - AsyncContext class

---

## @b9g/cookies

CookieStore API for servers.

- [Cookies](./cookies.md) - Cookie management

---

## @logtape/logtape

Structured logging (external package, Shovel-integrated).

- [Logging](./logging.md) - Logger configuration

# @b9g/admin

Admin app interface for Shovel applications. Auto-generates CRUD interfaces from ZenDB table schemas.

## Features

- **Automatic CRUD** - List, create, edit, delete records from any `@b9g/zen` table
- **Schema introspection** - Automatically detects columns, types, primary keys, foreign keys
- **Form generation** - Builds forms based on column types (text, number, date, boolean, enum)
- **USWDS styling** - Uses the U.S. Web Design System for accessible, professional UI
- **Required authorization** - Every route runs your `authorize` check; fails closed
- **CSRF protection** - State-changing requests must come from the same origin
- **Mountable router** - Mount on any path in your Shovel app

## Installation

```bash
npm install @b9g/admin
```

## Quick Start

```typescript
import {Router} from "@b9g/router";
import {createAdmin} from "@b9g/admin";
import * as schema from "./db/schema.js";

const router = new Router();

// Create and mount admin
const admin = createAdmin({
  database: "main",
  schema,
  // Runs before every admin request. Return true to allow.
  authorize: async (request) => {
    const session = await getSession(request); // your session lookup
    return session?.user.isAdmin ?? false;
  },
});

router.mount("/admin", admin);

self.addEventListener("fetch", (event) => {
  event.respondWith(router.handle(event.request));
});
```

## Configuration

```typescript
interface AdminConfig {
  /** Database name from shovel.json */
  database: string;

  /** Schema object containing @b9g/zen tables */
  schema: Record<string, unknown>;

  /** Required authorization check (see Security below) */
  authorize:
    | ((request: Request, context: RouteContext) =>
        boolean | Response | Promise<boolean | Response>)
    | "unsafe-allow-all";

  /** Per-model customization */
  models?: {
    [tableName: string]: {
      name?: string;           // Display name
      listFields?: string[];   // Columns to show in list view
      searchFields?: string[]; // Searchable columns
      excludeFields?: string[]; // Hidden from forms
      readOnlyFields?: string[]; // Non-editable fields
      pageSize?: number;       // Items per page
    };
  };

  /** Branding */
  branding?: {
    title?: string;  // Admin panel title
    logo?: string;   // Logo URL
  };

  /** USWDS asset URLs */
  assets?: {
    css: string;
    js: string;
  };
}
```

## Security

The admin exposes full read and write access to your database, so
`AdminRouter` refuses to construct without an `authorize` option.

### Authorization

`authorize(request, context)` runs before every admin route, including 404s:

- `true` allows the request
- a `Response` is sent instead, e.g. a redirect to your login page or a `401`
  challenge
- `false` (or anything else) denies with `403 Forbidden`

The check is registered as middleware in the `AdminRouter` constructor, so it
also applies when the admin is mounted on another router.

```typescript
const admin = new AdminRouter({
  database: "main",
  schema,
  authorize: (request) => {
    if (!isAdmin(request)) {
      return Response.redirect("/login", 302);
    }
    return true;
  },
});
```

For local development only, `authorize: "unsafe-allow-all"` disables the
check and logs a warning. Never deploy with it.

### CSRF

Every request other than `GET`, `HEAD` and `OPTIONS` must be same-origin:

- If the browser sends `Sec-Fetch-Site`, it must be `same-origin`
- Otherwise `Origin` must match the request URL's origin, falling back to
  `Referer` when `Origin` is absent
- Requests with none of these headers are rejected with `403`

The admin's own forms pass this check without any tokens. Behind a TLS
terminating proxy, older browsers without `Sec-Fetch-Site` only pass if
`request.url` reflects the public origin.

## Schema Introspection

The admin introspects `@b9g/zen` tables to extract:

- Column names and types
- Primary keys
- Foreign key relationships
- Enum values
- Required/optional fields
- Default values

```typescript
import {isTable} from "@b9g/zen";

// Check if a value is a zen table
isTable(users); // true
```

## Routes

When mounted at `/admin`, the following routes are available:

| Route | Description |
|-------|-------------|
| `/admin` | Dashboard with model cards |
| `/admin/:model` | List view for a model |
| `/admin/:model/new` | Create new record |
| `/admin/:model/:id` | View record |
| `/admin/:model/:id/edit` | Edit record |
| `/admin/:model/:id/delete` | Delete confirmation |

Login and logout are up to your application; point `authorize` at them.

## Display Names

Table and column names are automatically converted for display:

```typescript
import {getDisplayName, getPluralDisplayName} from "@b9g/admin";

getDisplayName("user_profiles");     // "User Profiles"
getPluralDisplayName("category");    // "Categories"
```

## Status

- [x] Schema introspection
- [x] CRUD routes (list, create, edit, delete)
- [x] Form generation with validation
- [x] USWDS styling
- [x] Required authorization hook and CSRF protection
- [ ] Built-in OAuth2 login
- [ ] Search and filtering
- [ ] Pagination
- [ ] Foreign key dropdowns

## License

MIT

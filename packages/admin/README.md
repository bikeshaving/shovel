# @b9g/admin

Admin app interface for Shovel applications. Auto-generates CRUD interfaces from ZenDB table schemas.

## Features

- **Automatic CRUD** - List, create, edit, delete records from any `@b9g/zen` table
- **Schema introspection** - Automatically detects columns, types, primary keys, foreign keys
- **Form generation** - Builds forms based on column types (text, number, date, boolean, enum)
- **USWDS styling** - Uses the U.S. Web Design System for accessible, professional UI
- **OAuth2 authentication** - Google, GitHub, Microsoft providers (WIP)
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
  auth: {
    providers: ["google"],
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

  /** Authentication configuration */
  auth: {
    providers: ("google" | "github" | "microsoft")[];
    allowedDomains?: string[];  // Email domain whitelist
    sessionMaxAge?: number;      // Session TTL in seconds
  };

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
| `/admin/:model/:id` | View/edit record |
| `/admin/:model/:id/delete` | Delete confirmation |
| `/admin/auth/login` | Login page |
| `/admin/auth/:provider` | OAuth2 flow start |
| `/admin/auth/callback` | OAuth2 callback |

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
- [ ] OAuth2 authentication (stub routes exist)
- [ ] Search and filtering
- [ ] Pagination
- [ ] Foreign key dropdowns

## License

MIT

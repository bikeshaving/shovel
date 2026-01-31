---
title: Routing
description: Learn how to define routes and handle HTTP requests.
---

Shovel uses a fast, standards-based router. Define routes and handlers to respond to HTTP requests.

## Basic Routes

```typescript
import { Router } from "@b9g/router";

const router = new Router();

// Static routes
router.route("/").get(() => new Response("Home"));
router.route("/about").get(() => new Response("About"));

// Route parameters
router.route("/users/:id").get((request, context) => {
  return Response.json({ id: context.params.id });
});

self.addEventListener("fetch", (event) => {
  event.respondWith(router.handle(event.request));
});
```

## HTTP Methods

Chain multiple methods on a route:

```typescript
router
  .route("/users/:id")
  .get(getUser)
  .put(updateUser)
  .delete(deleteUser);
```

## Reading Request Data

```typescript
router.route("/users").post(async (request) => {
  const body = await request.json();
  return Response.json({ received: body });
});
```

## Returning Responses

```typescript
// JSON
return Response.json({ message: "Hello" });

// HTML
return new Response("<h1>Hello</h1>", {
  headers: { "Content-Type": "text/html" },
});

// Redirect
return Response.redirect("/new-path", 301);
```

## Next Steps

- See [Routing Reference](/docs/routing) for advanced patterns
- Learn about [Middleware](/docs/middleware) for request processing

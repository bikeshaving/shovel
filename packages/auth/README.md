# @b9g/auth

Universal authentication for ServiceWorker applications with OAuth2/PKCE support.

## Features

- 🔐 OAuth2 with PKCE (Proof Key for Code Exchange)
- 🌍 Works across all platforms (Node.js, Bun, Cloudflare)
- 🍪 Cookie-based session management using standards-compliant Cookie Store API
- 🌐 Access cookies via `self.cookieStore` (ServiceWorker global API)
- 🔌 Built-in provider presets (GitHub, Google, Microsoft)
- 🛣️ Router middleware integration
- 🛡️ CSRF protection with state parameter
- ⚡ Zero dependencies (uses Web standards)

## Installation

```bash
bun add @b9g/auth @b9g/router @b9g/platform
```

## Quick Start

```typescript
import {Router} from "@b9g/router";
import {
  OAuth2Client,
  createProviderConfig,
  redirectToProvider,
  handleCallback,
  requireAuth,
  createSession,
  fetchUserInfo,
} from "@b9g/auth";

// Create OAuth2 client with GitHub preset
const config = createProviderConfig("github", {
  clientId: process.env.GITHUB_CLIENT_ID!,
  clientSecret: process.env.GITHUB_CLIENT_SECRET,
  redirectUri: "https://myapp.com/auth/callback",
  scopes: ["user:email"],
});

const oauth = new OAuth2Client(config);
const router = new Router();

// Start OAuth flow
router.route("/auth/login").get(redirectToProvider(oauth));

// Handle OAuth callback
router.route("/auth/callback").get(
  handleCallback(oauth, {
    async onSuccess(tokens, request, context) {
      // Create session cookie using self.cookieStore
      await createSession(self.cookieStore, tokens);

      // Fetch user info
      const user = await fetchUserInfo("github", tokens.accessToken);

      return Response.redirect("/dashboard");
    },
  })
);

// Protected route
router.route("/api/user").get(
  requireAuth(),
  async (request, context) => {
    // context.session contains the access token
    return Response.json({session: context.session});
  }
);

// Attach router to ServiceWorker
self.addEventListener("fetch", (event) => {
  event.respondWith(
    router.handler(event.request).then((response) => {
      if (response) return response;
      return new Response("Not Found", {status: 404});
    })
  );
});
```

## API Reference

### OAuth2Client

```typescript
const client = new OAuth2Client({
  authorizationEndpoint: "https://provider.com/oauth/authorize",
  tokenEndpoint: "https://provider.com/oauth/token",
  clientId: "your-client-id",
  clientSecret: "your-client-secret", // Optional for PKCE
  redirectUri: "https://yourapp.com/callback",
  scopes: ["read:user"],
});
```

### Provider Presets

Built-in presets for popular providers:

```typescript
import {createProviderConfig} from "@b9g/auth";

// GitHub
const github = createProviderConfig("github", {
  clientId: process.env.GITHUB_CLIENT_ID!,
  redirectUri: "https://myapp.com/auth/callback",
});

// Google
const google = createProviderConfig("google", {
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri: "https://myapp.com/auth/callback",
});

// Microsoft
const microsoft = createProviderConfig("microsoft", {
  clientId: process.env.MICROSOFT_CLIENT_ID!,
  redirectUri: "https://myapp.com/auth/callback",
});
```

### Middleware

#### `redirectToProvider(client)`

Starts OAuth2 flow by redirecting to provider's authorization endpoint.

#### `handleCallback(client, options)`

Handles OAuth2 callback, exchanges code for tokens.

```typescript
handleCallback(oauth, {
  async onSuccess(tokens, request, context) {
    // Store tokens, create session, etc.
    return Response.redirect("/dashboard");
  },
  async onError(error) {
    return new Response(`Auth error: ${error.message}`, {status: 400});
  },
})
```

#### `requireAuth(options)`

Protects routes - requires valid session cookie.

```typescript
requireAuth({
  sessionCookieName: "session", // Default
  async onUnauthorized() {
    return Response.redirect("/auth/login");
  },
})
```

### Session Helpers

#### `createSession(cookieStore, tokens, options)`

Stores access token in secure cookie.

#### `clearSession(cookieStore, options)`

Removes session cookie (for logout).

## Security Best Practices

1. **Always use HTTPS** in production
2. **Use PKCE** for public clients (SPA, mobile)
3. **Validate state parameter** (handled automatically)
4. **Set secure cookie options** (handled by Cookie Store API)
5. **Implement token refresh** for long-lived sessions
6. **Never expose client secrets** in client-side code

## How It Works

### OAuth2 + PKCE Flow

1. **Start Authorization**
   - Generate code verifier and challenge
   - Store verifier in secure cookie
   - Redirect to OAuth provider

2. **User Authenticates**
   - User logs in at provider
   - Provider redirects back with code

3. **Exchange Code**
   - Retrieve verifier from cookie
   - Exchange code + verifier for tokens
   - Validate state parameter

4. **Create Session**
   - Store access token in secure cookie
   - Remove PKCE cookies

## License

MIT

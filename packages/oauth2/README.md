# @b9g/oauth2

OAuth2 middleware for ServiceWorker applications.

WORK IN PROGRESS (do not use)

## Features

- OAuth2 with PKCE (Proof Key for Code Exchange)
- CORS middleware for cross-origin requests
- Works across all platforms (Node.js, Bun, Cloudflare)
- Encrypted, HttpOnly session cookies using standards-compliant Cookie Store API
- Access cookies via `self.cookieStore` (ServiceWorker global API)
- Built-in provider presets (GitHub, Google, Microsoft)
- Router middleware integration
- CSRF protection with state parameter
- Zero dependencies (uses Web standards)

## Installation

```bash
npm i @b9g/oauth2 @b9g/router
```

## Quick Start

```typescript
import {Router} from "@b9g/router";
import {OAuth2Client, createSession} from "@b9g/oauth2";
import {createProviderConfig, fetchUserInfo} from "@b9g/oauth2/providers";
import {
  redirectToProvider,
  handleCallback,
  requireAuth,
} from "@b9g/oauth2/middleware";

// Create OAuth2 client with GitHub preset
const config = createProviderConfig("github", {
  clientID: process.env.GITHUB_CLIENT_ID!,
  clientSecret: process.env.GITHUB_CLIENT_SECRET,
  redirectURI: "https://myapp.com/auth/callback",
  scopes: ["user:email"],
});

// Encrypts and authenticates the session cookie (at least 32 characters)
const secret = process.env.SESSION_SECRET!;

const oauth = new OAuth2Client(config);
const router = new Router();

// Start OAuth flow
router.route("/auth/login").get(redirectToProvider(oauth));

// Handle OAuth callback
router.route("/auth/callback").get(
  handleCallback(oauth, {
    async onSuccess(tokens, request, context) {
      // Create session cookie using self.cookieStore
      await createSession(self.cookieStore, tokens, {secret});

      // Fetch user info
      const user = await fetchUserInfo("github", tokens.accessToken);

      return Response.redirect("/dashboard");
    },
  })
);

// Protected route
router.use("/api/user", requireAuth({secret}));
router.route("/api/user").get(async (request, context) => {
  // context.oauth2 contains the tokens from the verified session
  const user = await fetchUserInfo("github", context.oauth2!.accessToken);
  return Response.json(user);
});

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

## Exports

### Classes

- `OAuth2Client` - OAuth2 client for authorization flows

### Functions

#### OAuth2 Flow
- `redirectToProvider(client)` - Middleware to start OAuth2 flow
- `handleCallback(client, options)` - Middleware to handle OAuth2 callback
- `requireAuth(options)` - Middleware to protect routes

#### Sessions
- `createSession(cookieStore, tokens, options)` - Store tokens in an encrypted session cookie
- `getSession(cookieStore, options)` - Read and verify the session cookie
- `clearSession(cookieStore, options?)` - Remove the session cookie

#### Provider Helpers
- `createProviderConfig(name, options)` - Create OAuth2 config from provider preset
- `getProvider(name)` - Get provider configuration
- `fetchUserInfo(provider, accessToken)` - Fetch user info from provider

#### PKCE Utilities
- `generateCodeVerifier(length?)` - Generate PKCE code verifier
- `generateCodeChallenge(verifier)` - Generate PKCE code challenge from verifier
- `generateState(length?)` - Generate random state parameter

### Types

- `CORSOptions` - CORS middleware configuration
- `OAuth2Config` - OAuth2 client configuration
- `OAuth2Tokens` - OAuth2 token response
- `OAuth2User` - User info from OAuth2 provider
- `SessionOptions` - Session cookie configuration (`secret`, `sessionCookieName`)
- `ProviderName` - Supported provider names ('github' | 'google' | 'microsoft')
- `ProviderConfig` - Provider configuration preset

### Constants

- `providers` - Built-in provider configurations

## API Reference

### CORS

```typescript
import {cors} from "@b9g/router/middleware";

// Allow all origins
router.use(cors());

// Allow specific origin with credentials
router.use(cors({
  origin: "https://myapp.com",
  credentials: true
}));

// Allow multiple origins
router.use(cors({
  origin: ["https://app.example.com", "https://admin.example.com"]
}));

// Dynamic origin validation
router.use(cors({
  origin: (origin) => origin.endsWith(".example.com")
}));
```

**Options:**

- `origin` - Allowed origins: `"*"`, string, array, or function (default: `"*"`)
- `methods` - Allowed methods (default: `["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"]`)
- `allowedHeaders` - Allowed headers (default: `["Content-Type", "Authorization"]`)
- `exposedHeaders` - Headers exposed to browser
- `credentials` - Allow credentials (default: `false`)
- `maxAge` - Preflight cache max age in seconds (default: `86400`)

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
import {createProviderConfig} from "@b9g/oauth2/providers";

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

Handles OAuth2 callback, exchanges code for tokens. Without `onError`, failures
return `400 {"error": "Authentication failed"}` and the underlying error (which
may include the provider's response body) is logged with LogTape under the
`["shovel", "oauth2"]` category.

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

Protects routes - requires a valid session cookie created by `createSession()`
with the same secret. Missing, forged, tampered and expired sessions are
rejected; otherwise the session's tokens are available as `context.oauth2`.

```typescript
requireAuth({
  secret: process.env.SESSION_SECRET!, // Required
  sessionCookieName: "session", // Default
  async onUnauthorized() {
    return Response.redirect("/auth/login");
  },
})
```

### Session Helpers

Sessions are stateless: the tokens are encrypted into the cookie value with
AES-256-GCM, using a key derived (HKDF-SHA256) from `secret`. The cookie is
`HttpOnly`, `Secure`, `SameSite=Lax`, and its value carries its own expiry, so
neither the browser nor scripts on the page can read or alter the tokens.

Because the tokens live in the cookie, very large tokens (cookies are limited
to 4096 bytes) may not fit. Changing the secret invalidates all sessions.

#### `createSession(cookieStore, tokens, options)`

Stores tokens in an encrypted session cookie.

- `secret` - Required, at least 32 characters
- `sessionCookieName` - Cookie name (default: `"session"`)
- `maxAge` - Session lifetime in seconds (default: `tokens.expiresIn`, or 3600)

#### `getSession(cookieStore, options)`

Returns the session's `OAuth2Tokens`, or `null` if the cookie is missing,
forged or expired. Takes `secret` and `sessionCookieName`.

#### `clearSession(cookieStore, options)`

Removes session cookie (for logout).

### Breaking Changes

`createSession()` and `requireAuth()` now require a `secret`
option, and session cookies created by earlier versions (which held the raw
access token) are rejected, so existing users have to sign in again.
`context.oauth2` is now the `OAuth2Tokens` object rather than the raw cookie
string.

## Security Best Practices

1. **Always use HTTPS** in production
2. **Use PKCE** for public clients (SPA, mobile)
3. **Validate state parameter** (handled automatically)
4. **Keep the session secret private** and use a long random value
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
   - Encrypt tokens into an HttpOnly session cookie
   - Remove PKCE cookies

## License

MIT

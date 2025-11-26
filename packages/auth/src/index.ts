/**
 * @b9g/auth - Universal authentication for ServiceWorker applications
 *
 * Features:
 * - OAuth2/PKCE authentication flows
 * - Provider presets (GitHub, Google, Microsoft)
 * - Router middleware integration
 * - Cookie-based session management
 * - Cross-platform (Node.js, Bun, Cloudflare)
 */

// Core OAuth2/PKCE
export {
	OAuth2Client,
	type OAuth2Config,
	type OAuth2Tokens,
	type OAuth2User,
} from "./oauth2.js";
export {
	generateCodeVerifier,
	generateCodeChallenge,
	generateState,
} from "./pkce.js";

// Provider presets
export {
	type ProviderName,
	type ProviderConfig,
	providers,
	getProvider,
	createProviderConfig,
	fetchUserInfo,
} from "./providers.js";

// Router middleware
export {
	cors,
	type CORSOptions,
	redirectToProvider,
	handleCallback,
	requireAuth,
	createSession,
	clearSession,
} from "./middleware.js";

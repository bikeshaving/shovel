/**
 * OAuth2 Client with PKCE support
 * Universal authentication for ServiceWorker applications
 */

import {
	generateCodeVerifier,
	generateCodeChallenge,
	generateState,
} from "./pkce.js";
import type {RequestCookieStore} from "@b9g/platform";

// ============================================================================
// TYPES
// ============================================================================

export interface OAuth2Config {
	/** OAuth2 authorization endpoint */
	authorizationEndpoint: string;
	/** OAuth2 token endpoint */
	tokenEndpoint: string;
	/** Client ID */
	clientId: string;
	/** Client secret (optional for PKCE) */
	clientSecret?: string;
	/** Redirect URI */
	redirectUri: string;
	/** OAuth2 scopes */
	scopes?: string[];
	/** Additional authorization parameters */
	authorizationParams?: Record<string, string>;
}

export interface OAuth2Tokens {
	accessToken: string;
	refreshToken?: string;
	expiresIn?: number;
	tokenType?: string;
	scope?: string;
}

export interface OAuth2User {
	id: string;
	email?: string;
	name?: string;
	picture?: string;
	[key: string]: any;
}

// ============================================================================
// OAUTH2 CLIENT
// ============================================================================

export class OAuth2Client {
	#config: OAuth2Config;

	constructor(config: OAuth2Config) {
		this.#config = config;
	}

	/**
	 * Start OAuth2 authorization flow with PKCE
	 * Returns authorization URL to redirect user to
	 */
	async startAuthorization(cookieStore: RequestCookieStore): Promise<string> {
		// Generate PKCE parameters
		const codeVerifier = generateCodeVerifier();
		const codeChallenge = await generateCodeChallenge(codeVerifier);
		const state = generateState();

		// Store PKCE parameters in secure cookies
		await cookieStore.set({
			name: "oauth_verifier",
			value: codeVerifier,
			path: "/",
			sameSite: "lax",
			expires: Date.now() + 10 * 60 * 1000, // 10 minutes
		});

		await cookieStore.set({
			name: "oauth_state",
			value: state,
			path: "/",
			sameSite: "lax",
			expires: Date.now() + 10 * 60 * 1000, // 10 minutes
		});

		// Build authorization URL
		const authUrl = new URL(this.#config.authorizationEndpoint);
		authUrl.searchParams.set("client_id", this.#config.clientId);
		authUrl.searchParams.set("redirect_uri", this.#config.redirectUri);
		authUrl.searchParams.set("response_type", "code");
		authUrl.searchParams.set("code_challenge", codeChallenge);
		authUrl.searchParams.set("code_challenge_method", "S256");
		authUrl.searchParams.set("state", state);

		if (this.#config.scopes && this.#config.scopes.length > 0) {
			authUrl.searchParams.set("scope", this.#config.scopes.join(" "));
		}

		// Add additional authorization parameters
		if (this.#config.authorizationParams) {
			for (const [key, value] of Object.entries(
				this.#config.authorizationParams,
			)) {
				authUrl.searchParams.set(key, value);
			}
		}

		return authUrl.toString();
	}

	/**
	 * Handle OAuth2 callback and exchange code for tokens
	 */
	async handleCallback(
		request: Request,
		cookieStore: RequestCookieStore,
	): Promise<OAuth2Tokens> {
		const url = new URL(request.url);
		const code = url.searchParams.get("code");
		const state = url.searchParams.get("state");
		const error = url.searchParams.get("error");
		const errorDescription = url.searchParams.get("error_description");

		// Handle OAuth error
		if (error) {
			throw new Error(
				`OAuth2 error: ${error}${errorDescription ? ` - ${errorDescription}` : ""}`,
			);
		}

		// Validate code and state
		if (!code) {
			throw new Error("Missing authorization code");
		}

		if (!state) {
			throw new Error("Missing state parameter");
		}

		// Verify state matches
		const storedState = await cookieStore.get("oauth_state");
		if (!storedState || state !== storedState.value) {
			throw new Error("Invalid state parameter - possible CSRF attack");
		}

		// Get code verifier
		const storedVerifier = await cookieStore.get("oauth_verifier");
		if (!storedVerifier) {
			throw new Error("Missing code verifier - session expired");
		}

		// Exchange code for tokens
		const tokens = await this.#exchangeCodeForTokens(
			code,
			storedVerifier.value,
		);

		// Clean up PKCE cookies
		await cookieStore.delete("oauth_verifier");
		await cookieStore.delete("oauth_state");

		return tokens;
	}

	/**
	 * Exchange authorization code for tokens
	 */
	async #exchangeCodeForTokens(
		code: string,
		codeVerifier: string,
	): Promise<OAuth2Tokens> {
		const tokenParams = new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: this.#config.redirectUri,
			client_id: this.#config.clientId,
			code_verifier: codeVerifier,
		});

		// Add client secret if provided (confidential clients)
		if (this.#config.clientSecret) {
			tokenParams.set("client_secret", this.#config.clientSecret);
		}

		const response = await fetch(this.#config.tokenEndpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			},
			body: tokenParams.toString(),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`Token exchange failed: ${response.status} ${response.statusText} - ${errorText}`,
			);
		}

		const data = await response.json();

		return {
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
			expiresIn: data.expires_in,
			tokenType: data.token_type,
			scope: data.scope,
		};
	}

	/**
	 * Refresh access token using refresh token
	 */
	async refreshAccessToken(refreshToken: string): Promise<OAuth2Tokens> {
		const tokenParams = new URLSearchParams({
			grant_type: "refresh_token",
			refresh_token: refreshToken,
			client_id: this.#config.clientId,
		});

		if (this.#config.clientSecret) {
			tokenParams.set("client_secret", this.#config.clientSecret);
		}

		const response = await fetch(this.#config.tokenEndpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			},
			body: tokenParams.toString(),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`Token refresh failed: ${response.status} ${response.statusText} - ${errorText}`,
			);
		}

		const data = await response.json();

		return {
			accessToken: data.access_token,
			refreshToken: data.refresh_token || refreshToken, // Some providers don't return new refresh token
			expiresIn: data.expires_in,
			tokenType: data.token_type,
			scope: data.scope,
		};
	}
}

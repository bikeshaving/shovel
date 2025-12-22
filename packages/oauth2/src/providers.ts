/**
 * OAuth2 provider presets
 * Pre-configured settings for popular OAuth2 providers
 */

import {OAuth2Config} from "./index.js";

export type ProviderName = "github" | "google" | "microsoft";

export interface ProviderConfig extends Omit<
	OAuth2Config,
	"clientID" | "clientSecret" | "redirectURI" | "scopes"
> {
	/** User info endpoint */
	userInfoEndpoint?: string;
	/** Default scopes */
	defaultScopes?: string[];
}

/**
 * Provider configurations
 */
export const providers: Record<ProviderName, ProviderConfig> = {
	github: {
		authorizationEndpoint: "https://github.com/login/oauth/authorize",
		tokenEndpoint: "https://github.com/login/oauth/access_token",
		userInfoEndpoint: "https://api.github.com/user",
		defaultScopes: ["user:email"],
	},
	google: {
		authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
		tokenEndpoint: "https://oauth2.googleapis.com/token",
		userInfoEndpoint: "https://www.googleapis.com/oauth2/v2/userinfo",
		defaultScopes: ["openid", "email", "profile"],
		authorizationParams: {
			access_type: "offline", // Request refresh token
			prompt: "consent", // Always show consent screen for refresh token
		},
	},
	microsoft: {
		authorizationEndpoint:
			"https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
		tokenEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
		userInfoEndpoint: "https://graph.microsoft.com/v1.0/me",
		defaultScopes: ["openid", "email", "profile"],
	},
};

/**
 * Get provider configuration
 */
export function getProvider(name: ProviderName): ProviderConfig {
	const provider = providers[name];
	if (!provider) {
		throw new Error(`Unknown provider: ${name}`);
	}
	return provider;
}

/**
 * Create OAuth2 config from provider preset
 */
export function createProviderConfig(
	provider: ProviderName,
	options: {
		clientID: string;
		clientSecret?: string;
		redirectURI: string;
		scopes?: string[];
	},
): OAuth2Config {
	const preset = getProvider(provider);

	return {
		...preset,
		clientID: options.clientID,
		clientSecret: options.clientSecret,
		redirectURI: options.redirectURI,
		scopes: options.scopes || preset.defaultScopes,
	};
}

/**
 * Fetch user info from provider
 */
export async function fetchUserInfo(
	provider: ProviderName,
	accessToken: string,
): Promise<any> {
	const preset = getProvider(provider);

	if (!preset.userInfoEndpoint) {
		throw new Error(`Provider ${provider} does not have a userInfo endpoint`);
	}

	const response = await fetch(preset.userInfoEndpoint, {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: "application/json",
		},
	});

	if (!response.ok) {
		throw new Error(
			`Failed to fetch user info: ${response.status} ${response.statusText}`,
		);
	}

	return await response.json();
}

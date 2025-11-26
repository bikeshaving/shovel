/**
 * PKCE (Proof Key for Code Exchange) utilities
 * RFC 7636: https://tools.ietf.org/html/rfc7636
 */

/**
 * Generate a cryptographically random string for code verifier
 * @param length Length of the verifier (43-128 characters)
 */
export function generateCodeVerifier(length: number = 128): string {
	if (length < 43 || length > 128) {
		throw new Error("Code verifier length must be between 43 and 128");
	}

	const charset =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
	const randomValues = new Uint8Array(length);
	crypto.getRandomValues(randomValues);

	let verifier = "";
	for (let i = 0; i < length; i++) {
		verifier += charset[randomValues[i] % charset.length];
	}

	return verifier;
}

/**
 * Generate code challenge from code verifier using S256 method
 * @param verifier Code verifier string
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);
	const hash = await crypto.subtle.digest("SHA-256", data);

	// Base64URL encode the hash
	return base64URLEncode(hash);
}

/**
 * Base64URL encode a buffer (without padding)
 */
function base64URLEncode(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}

	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Generate a random state parameter for CSRF protection
 */
export function generateState(length: number = 32): string {
	return generateCodeVerifier(length);
}

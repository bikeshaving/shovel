/**
 * Certificate management for local HTTPS development
 *
 * Uses OpenSSL to generate self-signed certificates for localhost development.
 * Modern browsers treat *.localhost as secure by default (RFC 6761).
 */

import {execSync, spawnSync} from "child_process";
import {existsSync, mkdirSync, readFileSync} from "fs";
import {join} from "path";
import {getLogger} from "@logtape/logtape";
import {SHOVEL_DIR, CERTS_DIR} from "./paths.js";

const logger = getLogger(["shovel", "certs"]);

// Re-export for backwards compatibility
export {SHOVEL_DIR, CERTS_DIR};

/**
 * Certificate files returned by ensureCerts
 */
export interface CertFiles {
	/** PEM-encoded certificate content */
	cert: string;
	/** PEM-encoded private key content */
	key: string;
	/** Path to certificate file */
	certPath: string;
	/** Path to key file */
	keyPath: string;
}

/**
 * The localhost wildcard certificate filename
 */
const LOCALHOST_CERT_NAME = "localhost";

/**
 * Check if OpenSSL is installed and accessible
 */
function isOpenSSLInstalled(): boolean {
	try {
		const result = spawnSync("openssl", ["version"], {
			stdio: "pipe",
			encoding: "utf-8",
		});
		return result.status === 0;
	} catch (err) {
		logger.debug("OpenSSL check failed: {error}", {error: err});
		return false;
	}
}

/**
 * Generate a self-signed certificate using OpenSSL
 */
function generateCertificate(): {certPath: string; keyPath: string} {
	// Ensure certs directory exists
	if (!existsSync(CERTS_DIR)) {
		mkdirSync(CERTS_DIR, {recursive: true});
	}

	const certPath = join(CERTS_DIR, `${LOCALHOST_CERT_NAME}.pem`);
	const keyPath = join(CERTS_DIR, `${LOCALHOST_CERT_NAME}-key.pem`);

	logger.info("Generating self-signed certificate for localhost");

	try {
		// Generate self-signed certificate valid for localhost and *.localhost
		// Using Subject Alternative Names (SAN) for wildcard support
		execSync(
			`openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,DNS:*.localhost"`,
			{
				stdio: "pipe",
				cwd: CERTS_DIR,
			},
		);

		logger.info("Certificate generated: {certPath}", {certPath});
		return {certPath, keyPath};
	} catch (err) {
		throw new Error(
			`Failed to generate certificate: ${err instanceof Error ? err.message : err}`,
		);
	}
}

/**
 * Ensure the localhost wildcard certificate exists
 *
 * Generates a self-signed certificate using OpenSSL if one doesn't exist.
 * The certificate covers localhost and *.localhost domains.
 *
 * @param _domain - Ignored, kept for API compatibility. Always uses localhost wildcard.
 * @returns Certificate and key content
 * @throws Error if OpenSSL is not installed
 */
export async function ensureCerts(_domain?: string): Promise<CertFiles> {
	const certPath = join(CERTS_DIR, `${LOCALHOST_CERT_NAME}.pem`);
	const keyPath = join(CERTS_DIR, `${LOCALHOST_CERT_NAME}-key.pem`);

	// Check for cached certificate
	if (existsSync(certPath) && existsSync(keyPath)) {
		logger.debug("Using cached localhost certificate");
		const cert = readFileSync(certPath, "utf-8");
		const key = readFileSync(keyPath, "utf-8");
		return {cert, key, certPath, keyPath};
	}

	// Generate new certificate
	if (!isOpenSSLInstalled()) {
		throw new Error(
			"OpenSSL is required for HTTPS development but was not found. " +
				"Please install OpenSSL and ensure it's in your PATH.",
		);
	}

	generateCertificate();

	const cert = readFileSync(certPath, "utf-8");
	const key = readFileSync(keyPath, "utf-8");
	return {cert, key, certPath, keyPath};
}

/**
 * Get certificates for localhost wildcard domain
 *
 * Uses a single certificate valid for localhost and *.localhost.
 * Works for any subdomain like myapp.localhost, blog.localhost, etc.
 * Browsers treat .localhost domains as secure by default (RFC 6761).
 *
 * @returns Certificate and key content for localhost wildcard
 */
export async function ensureLocalhostCerts(): Promise<CertFiles> {
	return ensureCerts();
}

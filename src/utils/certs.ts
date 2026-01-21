/**
 * Certificate management for local HTTPS development
 *
 * Uses mkcert to generate trusted certificates for localhost development.
 * mkcert installs a local CA that browsers trust automatically.
 */

import {spawnSync} from "child_process";
import {existsSync, mkdirSync, readFileSync} from "fs";
import {join} from "path";
import {getLogger} from "@logtape/logtape";
import {CERTS_DIR} from "./paths.js";

const logger = getLogger(["shovel", "certs"]);

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
 * Check if mkcert is installed and accessible
 */
function isMkcertInstalled(): boolean {
	try {
		const result = spawnSync("mkcert", ["-help"], {
			stdio: "pipe",
			encoding: "utf-8",
		});
		return result.status === 0;
	} catch (err) {
		logger.debug("mkcert check failed: {error}", {error: err});
		return false;
	}
}

/**
 * Generate a certificate using mkcert
 */
function generateCertificate(domain: string): {
	certPath: string;
	keyPath: string;
} {
	// Ensure certs directory exists
	if (!existsSync(CERTS_DIR)) {
		mkdirSync(CERTS_DIR, {recursive: true});
	}

	const certPath = join(CERTS_DIR, `${domain}.pem`);
	const keyPath = join(CERTS_DIR, `${domain}-key.pem`);

	logger.info("Generating certificate for {domain}", {domain});

	const result = spawnSync(
		"mkcert",
		["-cert-file", certPath, "-key-file", keyPath, domain],
		{
			stdio: "pipe",
			encoding: "utf-8",
		},
	);

	if (result.status !== 0) {
		const error = result.stderr || result.stdout || "Unknown error";
		throw new Error(`Failed to generate certificate: ${error}`);
	}

	logger.info("Certificate generated: {certPath}", {certPath});
	return {certPath, keyPath};
}

/**
 * Ensure a certificate exists for the given domain
 *
 * Uses mkcert to generate a trusted certificate if one doesn't exist.
 * mkcert must be installed and its CA must be set up (`mkcert -install`).
 *
 * @param domain - The domain to generate a certificate for (e.g., "myapp.localhost")
 * @returns Certificate and key content
 * @throws Error if mkcert is not installed
 */
export async function ensureCerts(domain: string): Promise<CertFiles> {
	const certPath = join(CERTS_DIR, `${domain}.pem`);
	const keyPath = join(CERTS_DIR, `${domain}-key.pem`);

	// Check for cached certificate
	if (existsSync(certPath) && existsSync(keyPath)) {
		logger.debug("Using cached certificate for {domain}", {domain});
		const cert = readFileSync(certPath, "utf-8");
		const key = readFileSync(keyPath, "utf-8");
		return {cert, key, certPath, keyPath};
	}

	// Check mkcert is available
	if (!isMkcertInstalled()) {
		throw new Error(
			"mkcert is required for HTTPS development but was not found.\n" +
				"Install it with:\n" +
				"  brew install mkcert    # macOS\n" +
				"  mkcert -install        # then install the CA",
		);
	}

	generateCertificate(domain);

	const cert = readFileSync(certPath, "utf-8");
	const key = readFileSync(keyPath, "utf-8");
	return {cert, key, certPath, keyPath};
}

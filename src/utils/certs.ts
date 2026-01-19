/**
 * Certificate management for local HTTPS development
 *
 * Uses mkcert to generate locally-trusted development certificates.
 * Certificates are cached in ~/.shovel/certs/ for reuse across sessions.
 */

import {execSync, spawnSync} from "child_process";
import {existsSync, mkdirSync, readFileSync} from "fs";
import {homedir} from "os";
import {join} from "path";
import {getLogger} from "@logtape/logtape";

const logger = getLogger(["shovel", "certs"]);

/**
 * Shovel data directory (~/.shovel)
 */
export const SHOVEL_DIR = join(homedir(), ".shovel");

/**
 * Certificate storage directory (~/.shovel/certs)
 */
export const CERTS_DIR = join(SHOVEL_DIR, "certs");

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
export function isMkcertInstalled(): boolean {
	try {
		const result = spawnSync("mkcert", ["-version"], {
			stdio: "pipe",
			encoding: "utf-8",
		});
		return result.status === 0;
	} catch (error) {
		logger.debug("mkcert check failed: {error}", {error});
		return false;
	}
}

/**
 * Check if the mkcert CA is installed in the system trust store
 */
export function isMkcertCAInstalled(): boolean {
	try {
		// mkcert -CAROOT returns the path to the CA, will error if not set up
		const result = spawnSync("mkcert", ["-CAROOT"], {
			stdio: "pipe",
			encoding: "utf-8",
		});
		if (result.status !== 0) {
			return false;
		}

		// Check if the CA files exist
		const caRoot = result.stdout.trim();
		const rootCert = join(caRoot, "rootCA.pem");
		return existsSync(rootCert);
	} catch (error) {
		logger.debug("mkcert CA check failed: {error}", {error});
		return false;
	}
}

/**
 * Get installation instructions for mkcert based on the current platform
 */
export function getMkcertInstallInstructions(): string {
	const platform = process.platform;

	const instructions: string[] = [
		"mkcert is required for local HTTPS development.",
		"",
		"Install mkcert:",
	];

	if (platform === "darwin") {
		instructions.push("  brew install mkcert");
		instructions.push("  brew install nss  # for Firefox support");
	} else if (platform === "linux") {
		instructions.push("  # Debian/Ubuntu:");
		instructions.push("  sudo apt install libnss3-tools");
		instructions.push(
			"  curl -JLO https://github.com/FiloSottile/mkcert/releases/latest/download/mkcert-linux-amd64",
		);
		instructions.push("  sudo mv mkcert-linux-amd64 /usr/local/bin/mkcert");
		instructions.push("  sudo chmod +x /usr/local/bin/mkcert");
		instructions.push("");
		instructions.push("  # Or with Homebrew:");
		instructions.push("  brew install mkcert");
	} else if (platform === "win32") {
		instructions.push("  # With Chocolatey:");
		instructions.push("  choco install mkcert");
		instructions.push("");
		instructions.push("  # Or with Scoop:");
		instructions.push("  scoop install mkcert");
	} else {
		instructions.push(
			"  See: https://github.com/FiloSottile/mkcert#installation",
		);
	}

	instructions.push("");
	instructions.push("After installing, run:");
	instructions.push("  mkcert -install");
	instructions.push("");
	instructions.push(
		"This will create a local CA and add it to your system trust store.",
	);

	return instructions.join("\n");
}

/**
 * Install the mkcert CA into the system trust store
 * Requires user confirmation/sudo password
 */
export function installMkcertCA(): void {
	logger.info("Installing mkcert CA into system trust store...");

	try {
		// mkcert -install adds the CA to the system trust store
		execSync("mkcert -install", {stdio: "inherit"});
		logger.info("mkcert CA installed successfully");
	} catch (error) {
		throw new Error(
			"Failed to install mkcert CA. Run 'mkcert -install' manually.",
		);
	}
}

/**
 * Generate a certificate for the given domain using mkcert
 *
 * @param domain - Domain to generate certificate for (e.g., 'myapp.localhost')
 * @returns Paths to the generated cert and key files
 */
function generateCertificate(domain: string): {
	certPath: string;
	keyPath: string;
} {
	// Ensure certs directory exists
	if (!existsSync(CERTS_DIR)) {
		mkdirSync(CERTS_DIR, {recursive: true});
	}

	// Certificate file paths
	const certPath = join(CERTS_DIR, `${domain}.pem`);
	const keyPath = join(CERTS_DIR, `${domain}-key.pem`);

	logger.info("Generating certificate for {domain}", {domain});

	try {
		// Generate certificate with mkcert
		// -cert-file and -key-file specify output paths
		execSync(
			`mkcert -cert-file "${certPath}" -key-file "${keyPath}" "${domain}" "*.${domain}"`,
			{
				stdio: "pipe",
				cwd: CERTS_DIR,
			},
		);

		logger.info("Certificate generated: {certPath}", {certPath});
		return {certPath, keyPath};
	} catch (error) {
		throw new Error(
			`Failed to generate certificate for ${domain}: ${error instanceof Error ? error.message : error}`,
		);
	}
}

/**
 * Ensure certificates exist for the given domain
 *
 * This function:
 * 1. Checks if mkcert is installed (throws with install instructions if not)
 * 2. Checks if mkcert CA is installed (installs it if not)
 * 3. Generates or returns cached certificates for the domain
 *
 * @param domain - Domain to get certificates for (e.g., 'myapp.localhost')
 * @returns Certificate and key content
 * @throws Error if mkcert is not installed
 */
export async function ensureCerts(domain: string): Promise<CertFiles> {
	// Step 1: Check mkcert installation
	if (!isMkcertInstalled()) {
		throw new Error(getMkcertInstallInstructions());
	}

	// Step 2: Check/install mkcert CA
	if (!isMkcertCAInstalled()) {
		logger.info("mkcert CA not found, installing...");
		installMkcertCA();
	}

	// Step 3: Check for cached certificate
	const certPath = join(CERTS_DIR, `${domain}.pem`);
	const keyPath = join(CERTS_DIR, `${domain}-key.pem`);

	if (!existsSync(certPath) || !existsSync(keyPath)) {
		// Generate new certificate
		generateCertificate(domain);
	} else {
		logger.debug("Using cached certificate for {domain}", {domain});
	}

	// Read and return certificate content
	const cert = readFileSync(certPath, "utf-8");
	const key = readFileSync(keyPath, "utf-8");

	return {
		cert,
		key,
		certPath,
		keyPath,
	};
}

/**
 * Get certificates for a wildcard localhost domain
 *
 * Uses *.localhost which works for any subdomain like myapp.localhost, blog.localhost, etc.
 * Browsers trust .localhost domains by default (RFC 6761).
 *
 * @returns Certificate and key content for localhost wildcard
 */
export async function ensureLocalhostCerts(): Promise<CertFiles> {
	return ensureCerts("localhost");
}
